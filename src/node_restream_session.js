//
//  Created by Mingliang Chen on 18/3/16.
//  illuspas[a]gmail.com
//  Copyright (c) 2018 Nodemedia. All rights reserved.
//
const Logger = require('./node_core_logger');
const NodeCoreUtils = require('./node_core_utils');

const EventEmitter = require('events');
const { spawn } = require('child_process');

// const RTSP_TRANSPORT = ['udp', 'tcp', 'udp_multicast', 'http'];

class NodeRestreamSession extends EventEmitter {
  constructor(conf) {
    super();
    this.conf = Object.assign({},conf);
    this.id = NodeCoreUtils.generateNewSessionID();
    this.ts = Date.now() / 1000 | 0;
    this.TAG = 'Restream';
  }

  run(processType="restream") {
    // let format = this.conf.inPath.startsWith('rtmp://') ? 'live_flv' : 'flv';
    // let format = 'mpegts';
    let format = 'flv';
    let argv = [];
    switch(processType){
      case "restream":
        argv = ['-y','-i',
          this.conf.inPath, '-c', 'h264', '-f', format, this.conf.ouPath];
        break;
      case "fallback":
        argv = ['-re','-y','-use_wallclock_as_timestamps','1','-f', 'lavfi','-stream_loop', '-1', '-i','color=c=black:s=512x512',
          '-vf',"drawbox=x=80:y=180:w=352:h=200:color=white:t=fill, \
       drawtext=text='Uh oh, signal lost!':x=(w-text_w)/2:y=200:fontsize=30:fontcolor=black:font=Times, \
       drawtext=text='We should be back in 5 minutes.': \
       x=(w-text_w)/2:y=250:fontsize=15:fontcolor=black:font=Times, \
      drawtext=text='If not, read this message again.': \
      x=(w-text_w)/2:y=280:fontsize=15:fontcolor=black:font=Times:alpha=0.3, \
       drawtext=text='%{gmtime\\:%Y/%m/%d %T}': \
       x=(w-text_w)/2:y=330:fontsize=15:fontcolor=black:font=Times;fps=12.5",
           '-c', 'libx264', '-r',12.5, '-b:v','4500k', '-pix_fmt','yuv420p10le', '-f', format, this.conf.ouPath]
          break;
      case "persistence":
        argv = ["-c",`sleep infinity > ${this.conf.inPath}`];
        break;
      case "create_pipe":
        argv = ["-c", `[[ ! -p ${this.conf.inPath} ]] && mkfifo ${this.conf.inPath}`];
        break;
      default:
        Logger.error(`Invalid process type requested to spawn: ${processType}`);
        return '';
    }

    Logger.log('[Restream task] id=' + this.id, `cmd=${this.conf.ffmpeg}`, argv.join(' '));

    this.ffmpeg_exec = spawn(this.conf.ffmpeg, argv);
    this.ffmpeg_exec.on('error', (e) => {
      Logger.log(e);
    });

    this.ffmpeg_exec.stdout.on('data', (data) => {
      Logger.ffdebug(`FF_LOG:${data}`);
    });

    this.ffmpeg_exec.stderr.on('data', (data) => {
      Logger.ffdebug(`FF_LOG:${data}`);
    });

    this.ffmpeg_exec.on('close', (code) => {
      Logger.log('[Restream end] id=' + this.id, 'code=' + code, this.conf.ffmpeg, processType);
      this.emit('end', this.id);
    });
  }

  end() {
    this.ffmpeg_exec.kill();
  }
}

module.exports = NodeRestreamSession;
