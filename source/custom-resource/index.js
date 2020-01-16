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

    let responseStatus = 'FAILED';
    let responseData = {};
    if(event.Records[0]['eventName'] == "ObjectCreated:Put") {
        let originalImage = getOriginalImage(event.Records[0].s3.bucket.name, event.Records[0].s3.object.key);
        console.log('originalImage', originalImage);


            // try {
            //     // const overlayImage = await request;
            //     image.png().tile({
            //         size: 512,
            //         layout: 'zoomify'
            //       }).toFile('tiled.dz', function(err, info) {
            //         console.log(info)
            //         // output.dzi is the Deep Zoom XML definition
            //         // output_files contains 512x512 tiles grouped by zoom level
            //       });
            //       sendResponse(event, callback, context.logStreamName, 'SUCCESS');
            // } catch (err) {
            //     return Promise.reject({
            //         status: 500,
            //         code: err.code,
            //         message: err.message
            //     })
            // }
    }
    if (event.RequestType === 'Create') {
        console.log('Request type is create');
        if (event.ResourceProperties.customAction === 'putConfigFile') {
            let _s3Helper = new S3Helper();
            console.log(event.ResourceProperties.configItem);
            _s3Helper.putConfigFile(event.ResourceProperties.configItem, event.ResourceProperties.destS3Bucket, event.ResourceProperties.destS3key).then((data) => {
                responseStatus = 'SUCCESS';
                responseData = setting;
                sendResponse(event, callback, context.logStreamName, responseStatus, responseData);
            }).catch((err) => {
                responseData = {
                    Error: `Saving config file to ${event.ResourceProperties.destS3Bucket}/${event.ResourceProperties.destS3key} failed`
                };
                console.log([responseData.Error, ':\n', err].join(''));
                sendResponse(event, callback, context.logStreamName, responseStatus, responseData);
            });

        } else if (event.ResourceProperties.customAction === 'copyS3assets') {
            let _s3Helper = new S3Helper();

            _s3Helper.copyAssets(event.ResourceProperties.manifestKey,
                event.ResourceProperties.sourceS3Bucket, event.ResourceProperties.sourceS3key,
                event.ResourceProperties.destS3Bucket).then((data) => {
                responseStatus = 'SUCCESS';
                responseData = {};
                sendResponse(event, callback, context.logStreamName, responseStatus, responseData);
            }).catch((err) => {
                responseData = {
                    Error: `Copy of website assets failed`
                };
                console.log([responseData.Error, ':\n', err].join(''));
                sendResponse(event, callback, context.logStreamName, responseStatus, responseData);
            });

        } else if (event.ResourceProperties.customAction === 'createUuid') {
            responseStatus = 'SUCCESS';
            responseData = {
                UUID: uuidv4()
            };
            sendResponse(event, callback, context.logStreamName, responseStatus, responseData);

        } else if (event.ResourceProperties.customAction === 'checkSourceBuckets') {
            let _s3Helper = new S3Helper();

            _s3Helper.validateBuckets(event.ResourceProperties.sourceBuckets).then((data) => {
                responseStatus = 'SUCCESS';
                responseData = {};
                sendResponse(event, callback, context.logStreamName, responseStatus, responseData);
            }).catch((err) => {
                responseData = {
                    Error: `Could not find the following source bucket(s) in your account: ${err}. Please specify at least one source bucket that exists within your account and try again. If specifying multiple source buckets, please ensure that they are comma-separated.`
                };
                console.log(responseData.Error);
                sendResponse(event, callback, context.logStreamName, responseStatus, responseData, responseData.Error);
            });

        } else if (event.ResourceProperties.customAction === 'sendMetric') {
            if (event.ResourceProperties.anonymousData === 'Yes') {
                let _metric = {
                    Solution: event.ResourceProperties.solutionId,
                    UUID: event.ResourceProperties.UUID,
                    TimeStamp: moment().utc().format('YYYY-MM-DD HH:mm:ss.S'),
                    Data: {
                        Version: event.ResourceProperties.version,
                        Launch: moment().utc().format()
                    }
                };

                let _usageMetrics = new UsageMetrics();
                _usageMetrics.sendAnonymousMetric(_metric).then((data) => {
                    console.log(data);
                    console.log('Annonymous metrics successfully sent.');
                }).catch((err) => {
                    console.log(`Sending anonymous launch metric failed: ${err}`);
                });

                sendResponse(event, callback, context.logStreamName, 'SUCCESS', {});
            } else {
                sendResponse(event, callback, context.logStreamName, 'SUCCESS');
            }

        } else {
            sendResponse(event, callback, context.logStreamName, 'SUCCESS');
        }
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
let getOriginalImage = function(bucket, key) {
    // const imageLocation = { Bucket: bucket, Key: key };
    const imageLocation = { Bucket: 'dronebase-development', Key: '/assets/mission/images/101284-6fefcbfcc3053d15f186944b50f467ca0e61d279/original-0c41dea38ae1a6ada4067241138ab4f8487e181f.JPG' };

    try {
        const originalImage = s3.getObject(imageLocation);
        const image = sharp(originalImage);
        image.png().tile({
            size: 512,
            layout: 'zoomify'
          }).toFile('tiled.dz', function(err, info) {
            console.log('error', err);
            console.log('info', info);
            // output.dzi is the Deep Zoom XML definition
            // output_files contains 512x512 tiles grouped by zoom level
          });
        return 'successfully loaded image';
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
