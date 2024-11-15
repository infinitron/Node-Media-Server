const Logger = require('./node_core_logger');

const NodeRestreamSession = require('./node_restream_session');
const context = require('./node_core_ctx');
const { getFFmpegVersion, getFFmpegUrl } = require('./node_core_utils');
const fs = require('fs');
const querystring = require('querystring');
const _ = require('lodash');

class NodeRestreamServer {
  constructor(config) {
    this.config = config;
    this.fallbackSessions = new Map();
    this.mainSessions = new Map();
    this.restreamSessions = new Map();
    this.pipePersistances = new Map();
  }

  async run() {
    try {
      fs.accessSync(this.config.restream.ffmpeg, fs.constants.X_OK);
    } catch (error) {
      Logger.error(`Node Media Fallback Server startup failed. ffmpeg:${this.config.fallback.ffmpeg} cannot be executed.`);
      return;
    }

    let version = await getFFmpegVersion(this.config.restream.ffmpeg);
    if (version === '' || parseInt(version.split('.')[0]) < 4) {
      Logger.error('Node Media Fallback Server startup failed. ffmpeg requires version 4.0.0 above');
      Logger.error('Download the latest ffmpeg static program:', getFFmpegUrl());
      return;
    }

    context.nodeEvent.on('postPublish', this.onPostPublish.bind(this));
    context.nodeEvent.on('donePublish',this.onDonePublish.bind(this));
    let str = this.streamFromPipe.bind(this);
    str();
    Logger.log('Node Media Restream Server started');
  }

  streamFromPipe(){
    let i = this.config.restream.tasks.length;
    while (i--) {
      let conf = this.config.restream.tasks[i];   
      if(!conf.app || !conf.restream_key){
        Logger.error('Restream tasks require an app name and a restream key');
      }   
        // let hasApp = conf.edge.match(/rtmp:\/\/([^\/]+)\/([^\/]+)/);
        conf.inPath = conf.pipe;
        conf.ouPath = `rtmp://127.0.0.1:${this.config.rtmp.port}/${conf.app}/${conf.restream_key}`;
        
        
        
        // make the pipes persistent
        conf.ffmpeg = "bash"; // hacky
        let mkPipeSession = new NodeRestreamSession(conf);
        mkPipeSession.id = conf.restream_key;
        mkPipeSession.run("create_pipe");

        conf.ffmpeg="sh";
        let pSession = new NodeRestreamSession(conf);
        pSession.id = conf.restream_key;
        pSession.run("persistence");
        pSession.on('end', (id) => {
          this.pipePersistances.delete(id);
        });
        this.pipePersistances.set(conf.restream_key,pSession);
        
        conf.ffmpeg = this.config.restream.ffmpeg;
        let session = new NodeRestreamSession(conf);
        session.id = conf.restream_key;
        session.run("restream");
        session.on('end', (id) => {
          this.restreamSessions.delete(id);
        });
        this.restreamSessions.set(conf.restream_key, session);
        Logger.log('[Restream task: pipe to RTMP relay] start id=' + conf.restream_key, conf.inPath, 'to', conf.ouPath);

      // }
    }
  }

  onPostPublish(id, streamPath, args) {
    if (!this.config.restream.tasks) {
      return;
    }
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, stream] = _.slice(regRes, 1);
    let i = this.config.restream.tasks.length;
    while (i--) {
      let conf = this.config.restream.tasks[i];
      
      if (conf.stream === stream && app === conf.app) {
        // check for existing fallback session
        let fallbackSession = this.fallbackSessions.get(stream);
        if(fallbackSession){
          fallbackSession.end();
          this.fallbackSessions.delete(stream);
        }
        conf.ffmpeg = this.config.restream.ffmpeg;
        conf.inPath = `rtmp://127.0.0.1:${this.config.rtmp.port}${streamPath}`;
        conf.ouPath = conf.pipe 
        let session = new NodeRestreamSession(conf);
        session.id = id;
        session.on('end', (id) => {
          this.mainSessions.delete(id);
        });
        this.mainSessions.set(id, session);
        session.run("restream");
        Logger.log('[Restream task: main to pipe push] start id=' + id, conf.inPath, 'to', conf.ouPath);
      }
    }

  }

  onDonePublish(id, streamPath, args) {
    let session = this.mainSessions.get(id);
    if (session) {
      session.end();
    }
    let regRes = /\/(.*)\/(.*)/gi.exec(streamPath);
    let [app, stream] = _.slice(regRes, 1);
    let i = this.config.restream.tasks.length;
    while (i--) {
      let conf = this.config.restream.tasks[i];
      
      if (conf.stream === stream && app === conf.app) {
        conf.ffmpeg = this.config.restream.ffmpeg;
        conf.inPath = '';
        conf.ouPath = conf.pipe;
        let session = new NodeRestreamSession(conf);
        session.id = stream;
        session.on('end', (id) => {
          this.fallbackSessions.delete(id);
        });
        this.fallbackSessions.set(stream, session);
        session.run("fallback");
        Logger.log('[Restream task: fallback to pipe push] stop id=' + streamPath, ' fallback to', conf.ouPath);
      }
    }
  }

}

module.exports = NodeRestreamServer;