'use strict';

console.log('Loading function');

var AWS = require('aws-sdk');
var s3 = new AWS.S3();

var fs = require('fs');
var path = require('path');
var sharp = require('sharp');
var util = require('util');

/**
 * Request handler.
 */
exports.handler = (event, context, callback) => {

  const key = event.Records[0].s3.object.key
  console.log('Received key:', key);

  if(event.Records[0]['eventName'] == "ObjectCreated:Put" &&
    event.Records[0].s3.object.key.endsWith('/tiles/')){
    tileImage(event.Records[0].s3.bucket.name, key);
  }
};

/**
 * Gets the original image from an Amazon S3 bucket.
 * @param {String} bucket - The name of the bucket containing the image.
 * @param {String} key - The key name corresponding to the image.
 * @return {Promise} - The original image or an error.
 */
const tileImage = async function(bucket, key) {
  const imagesLocation = key.split('/tiles')[0]
  const uniq_key = imagesLocation.split('/').pop()
  const tmp_location = '/tmp/' + uniq_key

  try {
    const originalImage = await getOriginalImage(bucket, imagesLocation + '/');
    sharp(originalImage).png().tile({
      layout: 'zoomify'
    }).toFile(tmp_location + 'tiled.dz', function(err, info) {
      if (err) {
        console.log('err', err);
      } else {
        console.log('successfully tiled images ' + tmp_location);
        const tiledFolder = tmp_location + 'tiled/';
        return upload_tiles(tiledFolder, bucket, key);
      }
    });
  } catch(err) {
    console.error('failed to tileImage', err);
    if(err.message == "Should not be tiling back fill image") {
      return true
    } else {
      throw err;
    }
  }
}

/**
 * Gets the original image from an Amazon S3 bucket.
 * @param {String} bucket - The name of the bucket containing the image.
 * @param {String} key - The key name corresponding to the image.
 * @return {Promise} - The original image or an error.
 */
const getOriginalImage = async function(bucket, imagesLocation) {
  console.log('looking for objects in:', imagesLocation);
  const images = await getImageObjects(bucket, imagesLocation);
  const originalObject = images.find(isOriginal);
  console.log('originalObject filename', originalObject.Key);
  if(originalObject.Key.includes("backfill-original")) {
    throw new Error('Should not be tiling back fill image');
  } else {
    return downloadImage(bucket, originalObject.Key);
  }
}

function isOriginal(fileObject) {
  return fileObject.Key.includes("original-");
}

const getImageObjects = async function(bucket, location) {
  try {
    const imageObjects = await s3.listObjects({
      Bucket: bucket,
      Marker: location,
      Prefix: location,
      MaxKeys: 5
    }).promise();
    return Promise.resolve(imageObjects.Contents);
  }
  catch(err) {
    console.error('failed to getImageObjects', err);
    throw err;
  }
}

const downloadImage = async function(bucket, key){
  const imageLocation = { Bucket: bucket, Key: key };
  const request = s3.getObject(imageLocation).promise();
  try {
    const originalImage = await request;
    return Promise.resolve(originalImage.Body);
  }
  catch(err) {
    console.error('failed to downloadImage', err);
    throw err;
  }
}

const upload_tiles = function(base_tmpdir, destS3Bucket, s3_key) {
  return fs.promises.readdir(base_tmpdir).then(function(files) {
    files.forEach(filename => {
      const locationPath = base_tmpdir + filename;
      const destS3key = s3_key + filename;

      if (fs.lstatSync(locationPath).isDirectory()) {
        Promise.all(
          upload_recursive_dir(locationPath + '/', destS3Bucket, destS3key + '/', [])
          ).then(function(data) {
            console.log('successfully uploaded tiled images: ' + data.length);
          }).catch(function(exception) {
            console.log('caught exception:', exception);
            throw exception;
          });
        } else if(filename.endsWith('.xml')) {
          uploadToS3(destS3Bucket, destS3key, locationPath);
        }
      });
  }).catch(function(exception) {
    console.log('caught exception:', exception);
    throw exception;
  }).finally(function() {
    if (fs.existsSync(base_tmpdir)) {
      try {
        fs.rmdirSync(base_tmpdir, { recursive: true });
        console.log("Deleted " + base_tmpdir);
      } catch(err) {
        console.log("Meh! Failed to Deleted the deleted: ", err);
      }
    }
  });
}

const upload_recursive_dir = function(base_tmpdir, destS3Bucket, s3_key, promises) {
  const files = fs.readdirSync(base_tmpdir);

  files.forEach(function (filename) {
    const locationPath = base_tmpdir + filename;
    const destS3key = s3_key + filename;
    if (fs.lstatSync(locationPath).isDirectory()) {
      promises = upload_recursive_dir(locationPath + '/', destS3Bucket, destS3key + '/', promises);
    } else if(filename.endsWith('.png')) {
      promises.push(uploadToS3(destS3Bucket, destS3key, locationPath));
    }
  });
  return promises;
}

const uploadToS3 = function (bucketName, destS3key, filePath) {
  return s3.putObject({ Bucket: bucketName, Key: destS3key, Body: fs.readFileSync(filePath) }).promise();
}

