/*********************************************************************************************************************
 *  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

'use strict';

console.log('Loading function');

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const S3 = require('aws-sdk/clients/s3');
const s3 = new S3();
const sharp = require('sharp');
const https = require('https');
const url = require('url');
const moment = require('moment');
const S3Helper = require('./lib/s3-helper.js');
const UsageMetrics = require('./lib/usage-metrics');
const uuidv4 = require('uuid/v4');

/**
 * Request handler.
 */
exports.handler = (event, context, callback) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    console.log('Received event context:', context);
    console.log('Received event.RequestType:', event.RequestType);
    console.log('Received event.Records[0]:', event.Records[0]);
    if(event.Records[0]['eventName'] == "ObjectCreated:Put" && event.Records[0].s3.object.key.endsWith('/tiles')){
        tileImage(event.Records[0].s3.bucket.name, event.Records[0].s3.object.key);
        if(event.ResponseURL) {
            sendResponse(event, callback, context.logStreamName, 'SUCCESS');
        }
    }

    if (event.RequestType === 'Create') {
        console.log('Request type is create');
    }

    if (event.RequestType === 'Update') {
        console.log('Request type is update');
        sendResponse(event, callback, context.logStreamName, 'SUCCESS');
    }
};

/**
 * Gets the original image from an Amazon S3 bucket.
 * @param {String} bucket - The name of the bucket containing the image.
 * @param {String} key - The key name corresponding to the image.
 * @return {Promise} - The original image or an error.
 */
let tileImage = async function(bucket, key) {
    try {
        const originalImage = await getOriginalImage(bucket, key);
        const image = sharp(originalImage);
        const tiles = image.png().tile({
            size: 512,
            layout: 'zoomify'
          }).toFile('/tmp/tiled.dz', function(err, info) {
            console.log('error', err);
            // console.log('info', info);
            upload_recursive_dir('/tmp/tiled', bucket, key);
            // console.log('successfully uploaded tiled images');
        });
    }
    catch(err) {
        return Promise.reject({
            status: 500,
            code: err.code,
            message: err.message
        })
    }
}


/**
 * Gets the original image from an Amazon S3 bucket.
 * @param {String} bucket - The name of the bucket containing the image.
 * @param {String} key - The key name corresponding to the image.
 * @return {Promise} - The original image or an error.
 */
let getOriginalImage = async function(bucket, tilesKey) {
    const imagesLocation = tilesKey.split('/tiles')[0]
    let images = await getImageObjects(bucket, imagesLocation);
    let originalObject = images.find(isOriginal);
    // console.log('originalObject filename', originalObject.Key);
    return downloadImage(bucket, originalObject.Key);
}

function isOriginal(fileObject) {
    return fileObject.Key.includes("/original-");
}

let getImageObjects = async function(bucket, location) {
    const request = s3.listObjects({
        Bucket: bucket,
        Marker: location,
        MaxKeys: 10
    }).promise();
    try {
        const imageObjects = await request;
        return Promise.resolve(imageObjects.Contents);
    }
    catch(err) {
        return Promise.reject({
            status: 500,
            code: err.code,
            message: err.message
        })
    }
}

let downloadImage = async function(bucket, key){
    let imageLocation = { Bucket: bucket, Key: key };
    const request = s3.getObject(imageLocation).promise();
    try {
        const originalImage = await request;
        return Promise.resolve(originalImage.Body);
    }
    catch(err) {
        return Promise.reject({
            status: 500,
            code: err.code,
            message: err.message
        })
    }
}


let upload_recursive_dir = function(base_tmpdir, destS3Bucket, s3_key) {
    fs.readdir(base_tmpdir, function(err, filenames) {
        if (err) {
          return;
        }
        filenames.forEach(function(filename) {
            console.log('filename', filename);
            let curr_file = '/' + filename;
            let local_temp_path = base_tmpdir + curr_file;
            let destS3key = s3_key + curr_file;
            if (fs.lstatSync(local_temp_path).isDirectory()) {
                upload_recursive_dir(local_temp_path, destS3Bucket, destS3key);
            } else if(filename.endsWith('.xml') || filename.endsWith('.png')) {
                fs.readFile(local_temp_path, function (err, file) {
                    if (err) console.log(err, err.stack); // an error occurred
                    let params = {
                        Bucket: destS3Bucket,
                        Key: destS3key,
                        Body: file
                    }
                    s3.putObject(params, function(err, data) {
                       if (err) console.log(err, err.stack); // an error occurred
                       else     console.log(data);           // successful response
                     });
                });

            }
        });
    });
}

/**
 * Sends a response to the pre-signed S3 URL
 */
let sendResponse = function(event, callback, logStreamName, responseStatus, responseData, customReason) {

    const defaultReason = `See the details in CloudWatch Log Stream: ${logStreamName}`;
    const reason = (customReason !== undefined) ? customReason : defaultReason;

    const responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: reason,
        PhysicalResourceId: logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData,
    });

    console.log('RESPONSE BODY:\n', responseBody);
    const parsedUrl = url.parse(event.ResponseURL);
    const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: 'PUT',
        headers: {
            'Content-Type': '',
            'Content-Length': responseBody.length,
        }
    };

    const req = https.request(options, (res) => {
        console.log('STATUS:', res.statusCode);
        console.log('HEADERS:', JSON.stringify(res.headers));
        callback(null, 'Successfully sent stack response!');
    });

    req.on('error', (err) => {
        console.log('sendResponse Error:\n', err);
        callback(err);
    });

    req.write(responseBody);
    req.end();
};
