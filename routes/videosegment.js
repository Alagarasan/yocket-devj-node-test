const express = require('express');
const requests = require('requests');
const router = express.Router();
var ffmpeg = require('fluent-ffmpeg');
const { DownloaderHelper } = require('node-downloader-helper');
const { eachSeries } = require('async');

const videoSegmentByDuration = (req, res) => {
  const { video_link } = req.body;
  let interval_duration = parseFloat(req.body.interval_duration);
  if(!req.body.video_link || req.body.video_link.length === 0 || !req.body.interval_duration) {
    res.status(400).json({error: 'Invalid input'});
    return;
  }
  const dl = new DownloaderHelper(video_link, `${__dirname}/videos`);

  dl.on('end', () => { 
    ffmpeg.ffprobe(dl.__filePath, (err, metaData) => {
      if(err) {
        res.status(422).json({"reason": "could not process file"});
        return
      }
      const { duration } = metaData.format;
      if(duration < interval_duration) {
        res.status(400).json({"reason": "invalid interval duration"});
        return;
      }
      //.output(`./output/${dl.__fileName}${i}.mp4`)
      
      const splits = Math.ceil(duration/interval_duration);
      const loops = new Array(splits).fill(true);
      let start = 0;//, end = interval_duration;
      let i = 0;
      const resObj = { internal_videos: [] };
      eachSeries(loops, (item, done) => {

        i += 1;
        const overallTime = start + interval_duration;
        const availableTime = duration - start;
        interval_duration = overallTime > duration ? availableTime : interval_duration;
        const fileNm = `${dl.__fileName.slice(0, -4)}-${i}.mp4`;
        ffmpeg()
          .input(dl.__filePath)
          .inputOptions([ `-ss ${start}` ])
          .outputOptions([ `-t ${interval_duration}` ])
          .output(`./routes/output/${fileNm}`)
          .on('end', () => {
            start += interval_duration;
            resObj.internal_videos.push({ 'video_url': `http://localhost:8080/streamvideo?${fileNm}`})
            done();
          })
          .on('error', (err) => done(err))
          .run();
      }, err => {
        if(err) {
          res.status(422).json({"reason": "could not process file"});
          return;
        }else {
          res.status(200).json(resObj);
          return;
        }
      });
        

    });
  });
  dl.start();

}

const videoSegmentByRangeDuration = (req, res) => {
  const { video_link = '', interval_range = [] } = req.body;
  if(video_link.length === 0 || interval_range.length === 0) {
    res.status(400).json({error: 'Invalid input'});
    return;
  }
  const dl = new DownloaderHelper(video_link, `${__dirname}/videos`);

  dl.on('end', () => { 
    ffmpeg.ffprobe(dl.__filePath, (err, metaData) => {
      if(err) {
        res.status(422).json({"reason": "could not process file"});
        return
      }
      const { duration } = metaData.format;
      const { interval_range } = req.body;
      let invalidDuration = false;
      for (let index = 0; index < interval_range.length; index++) {
        const element = interval_range[index];
        if(element.start === undefined || !element.end || element.start > element.end || element.end > duration) {
          invalidDuration = true;
          break;
        }else {
          interval_range[index].clipDuration = element.end - element.start;
        }
      }

      if(invalidDuration) {
        res.status(400).json({"reason": "invalid interval duration"});
        return;
      }
      const resObj = { internal_videos: [] };
      let i = 0;

      eachSeries(interval_range, (item, done) => {
        i += 1;
        const fileNm = `${dl.__fileName.slice(0, -4)}-${i}.mp4`;
        ffmpeg()
          .input(dl.__filePath)
          .inputOptions([ `-ss ${parseFloat(item.start)}` ])
          .outputOptions([ `-t ${item.clipDuration}` ])
          .output(`./routes/output/${fileNm}`)
          .on('end', () => {
            resObj.internal_videos.push({ 'video_url': `http://localhost:8080/streamvideo?${fileNm}`})
            done();
          })
          .on('error', (err) => done(err))
          .run();
      }, err => {
        if(err) {
          res.status(422).json({"reason": "could not process file"});
          return;
        }else {
          res.status(200).json(resObj);
          return;
        }
      });
    
    })
  })
  dl.start();
}

const videoSegmentByNoOfSegments = (req, res) => {
  const { video_link = '', no_of_segments = 0 } = req.body;
  if(video_link.length === 0 || no_of_segments <= 0) {
    res.status(400).json({error: 'Invalid input'});
    return;
  }
  const dl = new DownloaderHelper(video_link, `${__dirname}/videos`);

  dl.on('end', () => { 
    ffmpeg.ffprobe(dl.__filePath, (err, metaData) => {
      if(err) {
        res.status(422).json({"reason": "could not process file"});
        return
      }
      const { duration } = metaData.format;
      const { interval_range } = req.body;
      let invalidDuration = false;
      
      if(no_of_segments > duration) {
        res.status(400).json({"reason": "invalid number of segments"});
        return;
      }
      let duration_list = new Array(no_of_segments).fill(duration/no_of_segments);
      //const remainingTime = duration%no_of_segments;
      //remainingTime && duration_list.push(remainingTime);

      const resObj = { internal_videos: [] };
      let i = 0;
      let start = 0;

      eachSeries(duration_list, (clipDuration, done) => {
        i += 1;
        const fileNm = `${dl.__fileName.slice(0, -4)}-${i}.mp4`;
        ffmpeg()
          .input(dl.__filePath)
          .inputOptions([ `-ss ${start}` ])
          .outputOptions([ `-t ${clipDuration}` ])
          .output(`./routes/output/${fileNm}`)
          .on('end', () => {
            start += clipDuration;
            resObj.internal_videos.push({ 'video_url': `http://localhost:8080/streamvideo?${fileNm}`})
            done();
          })
          .on('error', (err) => done(err))
          .run();
      }, err => {
        if(err) {
          res.status(422).json({"reason": "could not process file"});
          return;
        }else {
          res.status(200).json(resObj);
          return;
        }
      });
    
    })
  })
  dl.start();
};

const combineVideo = (req, res) => {
  const { segments = [], width = 0, height = 0 } = req.body;
  let inValidInput = false;
  let maxRange = 0;
  segments.map(item => {
    if(item.start > item.end) {
      inValidInput = true;
    }
    maxRange = item.end > maxRange ? item.end : maxRange;
  })
  if(inValidInput || segments.length === 0 || width === 0 || height === 0) {
    res.status(400).json({error: 'Invalid input'});
    return;
  }
  const fileList = [];
  let invalidDuration = false;
  let i = 0;
  eachSeries(segments, (item, done) => {
    const dl = new DownloaderHelper(item.video_url, `${__dirname}/videos`);
    dl.on('end', () => { 
      ffmpeg.ffprobe(dl.__filePath, (err, metaData) => {
        if(err) {
          res.status(422).json({"reason": "could not process file"});
          return
        }
        const { duration } = metaData.format;
        invalidDuration =  item.end > duration ? true : false;
        
        if(invalidDuration) {
          res.status(400).json({"reason": "invalid input arguments"});
          return;
        }
        i += 1;
        const fileLoc = `./routes/videos/${dl.__fileName.slice(0, -4)}-tocombine-${i}-${new Date().getTime()}.mp4`;
        ffmpeg()
        .input(dl.__filePath)
        .inputOptions([ `-ss ${item.start}` ])
        .outputOptions([ `-t ${item.end - item.start}` ])
        .output(`${fileLoc}`)
        .on('end', () => {
          fileList.push(fileLoc);
          done();
        })
        .on('error', (err) => done(err))
        .run();

      });

    });

    dl.start();
  }, err => {
    if(err || fileList.length === 0) {
      res.status(422).json({"reason": "could not process file"});
      return
    }else {
      let mergedVideo = ffmpeg();

      fileList.forEach(function(videoName){
        mergedVideo = mergedVideo.addInput(videoName);
      });
      const mergedFileName = `merged-${new Date().getTime()}-video.mp4`;
      mergedVideo.mergeToFile(`./routes/output/${mergedFileName}`)
      .on('error', (err) => {
        res.status(422).json({"reason": "could not process file"});
        return;
      })
      .on('end', () => {
        res.status(200).json({ 'video_url' : `http://localhost:8080/streamvideo?${mergedFileName}` });
        return;
      });
    }
  });

}

router.post('/api/process-interval', videoSegmentByDuration);
router.post('/api/process-ranges', videoSegmentByRangeDuration);
router.post('/api/process-segments', videoSegmentByNoOfSegments);
router.post('/api/combine-video', combineVideo);



module.exports = router;
