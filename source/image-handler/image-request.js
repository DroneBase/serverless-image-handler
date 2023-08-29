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

const {S3Client, GetObjectCommand} = require('@aws-sdk/client-s3')
const ThumborMapping = require('./thumbor-mapping');

class ImageRequest {

    /**
     * Initializer function for creating a new image request, used by the image
     * handler to perform image modifications.
     * @param {Object} event - Lambda request body.
     */
    async setup(event) {
        try {
            this.path = event['path'] ?? event['rawPath']
            this.requestType = this.parseRequestType(event);
            this.bucket = this.parseImageBucket(event, this.requestType);
            this.key = this.parseImageKey(event, this.requestType);
            this.edits = this.parseImageEdits(event, this.requestType);
            this.originalImage = await this.getOriginalImage(this.bucket, this.key)
            return Promise.resolve(this);
        } catch (err) {
            return Promise.reject(err);
        }
    }

    /**
     * Gets the original image from an Amazon S3 bucket.
     * @param {String} bucket - The name of the bucket containing the image.
     * @param {String} key - The key name corresponding to the image.
     * @return {Promise} - The original image or an error.
     */
    async getOriginalImage(bucket, key) {
        const s3 = new S3Client({region: process.env.SOURCE_BUCKET_REGION});

        try {
            console.log("Starting image retrieval from S3 ", {Bucket: bucket, Key: key})
            const {Body: imageStream, ...data} = await s3.send(new GetObjectCommand({Bucket: bucket, Key: key}));
            return new Promise((resolve, reject) => {
                const chunks = [];
                imageStream.on("data", (chunk) => chunks.push(chunk));
                imageStream.on("error", reject);
                imageStream.on("end", () => resolve({...data, Body: Buffer.concat(chunks)}));
            });
        }
        catch(err) {
            console.log('err :( ', err)
            return Promise.reject({
                status: 500,
                code: err.code,
                message: err.message
            })
        }
    }

    /**
     * Parses the name of the appropriate Amazon S3 bucket to source the
     * original image from.
     * @param {Object} event - Lambda request body.
     * @param {String} requestType - Image handler request type.
     */
    parseImageBucket(event, requestType) {
        if (requestType === "Default") {
            // Decode the image request
            const decoded = this.decodeRequest();
            if (decoded.bucket !== undefined) {
                // Check the provided bucket against the whitelist
                const sourceBuckets = this.getAllowedSourceBuckets();
                if (sourceBuckets.includes(decoded.bucket)) {
                    return decoded.bucket;
                }

                throw ({
                    status: 403,
                    code: 'ImageBucket::CannotAccessBucket',
                    message: 'The bucket you specified could not be accessed. Please check that the bucket is specified in your SOURCE_BUCKETS.'
                });
            }

            // Try to use the default image source bucket env var
            const sourceBuckets = this.getAllowedSourceBuckets();
            return sourceBuckets[0];
        }

        if (requestType === "Thumbor" || requestType === "Custom") {
            // Use the default image source bucket env var
            const sourceBuckets = this.getAllowedSourceBuckets();
            return sourceBuckets[0];
        }

        throw ({
            status: 400,
            code: 'ImageBucket::CannotFindBucket',
            message: 'The bucket you specified could not be found. Please check the spelling of the bucket name in your request.'
        });
    }

    /**
     * Parses the edits to be made to the original image.
     * @param {Object} event - Lambda request body.
     * @param {String} requestType - Image handler request type.
     */
    parseImageEdits(event, requestType) {
        if (requestType === "Default") {
            const decoded = this.decodeRequest();
            return decoded.edits;
        }

        if (requestType === "Thumbor") {
            const thumborMapping = new ThumborMapping();
            thumborMapping.process(event);
            return thumborMapping.edits;
        }

        if (requestType === "Custom") {
            const thumborMapping = new ThumborMapping();
            const parsedPath = thumborMapping.parseCustomPath(this.path);
            thumborMapping.process(parsedPath);
            return thumborMapping.edits;
        }

        throw ({
            status: 400,
            code: 'ImageEdits::CannotParseEdits',
            message: 'The edits you provided could not be parsed. Please check the syntax of your request and refer to the documentation for additional guidance.'
        });
    }

    /**
     * Parses the name of the appropriate Amazon S3 key corresponding to the
     * original image.
     * @param {Object} event - Lambda request body.
     * @param {String} requestType - Type, either "Default", "Thumbor", or "Custom".
     */
    parseImageKey(event, requestType) {
        if (requestType === "Default") {
            // Decode the image request and return the image key
            const decoded = this.decodeRequest();
            return decoded.key;
        }

        if (requestType === "Thumbor" || requestType === "Custom") {
            // Parse the key from the end of the path
            const key = (this.path).split("/");
            return key[key.length - 1];
        }

        // Return an error for all other conditions
        throw ({
            status: 400,
            code: 'ImageEdits::CannotFindImage',
            message: 'The image you specified could not be found. Please check your request syntax as well as the bucket you specified to ensure it exists.'
        });
    }

    /**
     * Determines how to handle the request being made based on the URL path
     * prefix to the image request. Categorizes a request as either "image"
     * (uses the Sharp library), "thumbor" (uses Thumbor mapping), or "custom"
     * (uses the rewrite function).
     * @param {Object} event - Lambda request body.
    */
    parseRequestType(event) {
        let truncatedPath = this.path;

        console.log('path ', truncatedPath)

        if (process.env.TRUNCATE_PATH_PREFIX !== undefined) {
            // Allows cloudfront to be shared by adding a prefix/* to behaviour
            truncatedPath = truncatedPath.replace(process.env.TRUNCATE_PATH_PREFIX, '')
        }
        // ----
        const matchDefault = new RegExp(/^(\/?)([0-9a-zA-Z+\/]{4})*(([0-9a-zA-Z+\/]{2}==)|([0-9a-zA-Z+\/]{3}=))?$/);
        const matchThumbor = new RegExp(/^(\/?)((fit-in)?|(filters:.+\(.?\))?|(unsafe)?).*(.+jpg|.+png|.+webp|.+tiff|.+jpeg)$/);
        const matchCustom = new RegExp(/(\/?)(.*)(jpg|png|webp|tiff|jpeg)/);
        const definedEnvironmentVariables = (
            (process.env.REWRITE_MATCH_PATTERN !== "") &&
            (process.env.REWRITE_SUBSTITUTION !== "") &&
            (process.env.REWRITE_MATCH_PATTERN !== undefined) &&
            (process.env.REWRITE_SUBSTITUTION !== undefined)
        );


        // ----
        if (matchDefault.test(truncatedPath)) {  // use sharp
            return 'Default';
        }

        if (matchCustom.test(truncatedPath) && definedEnvironmentVariables) {  // use rewrite function then thumbor mappings
            return 'Custom';
        }

        if (matchThumbor.test(truncatedPath)) {  // use thumbor mappings
            return 'Thumbor';
        }

        throw {
            status: 400,
            code: 'RequestTypeError',
            message: 'The type of request you are making could not be processed. Please ensure that your original image is of a supported file type (jpg, png, tiff, webp) and that your image request is provided in the correct syntax. Refer to the documentation for additional guidance on forming image requests.'
        };
    }

    /**
     * Decodes the base64-encoded image request path associated with default
     * image requests. Provides error handling for invalid or undefined path values.
     */
    decodeRequest() {
        if (this.path !== undefined) {
            const splitPath = this.path.split("/");
            const encoded = splitPath[splitPath.length - 1];
            const toBuffer = Buffer.from(encoded, 'base64');
            try {
                return JSON.parse(toBuffer.toString('ascii'));
            } catch (e) {
                throw ({
                    status: 400,
                    code: 'DecodeRequest::CannotDecodeRequest',
                    message: 'The image request you provided could not be decoded. Please check that your request is base64 encoded properly and refer to the documentation for additional guidance.'
                });
            }
        }

        throw ({
            status: 400,
            code: 'DecodeRequest::CannotReadPath',
            message: 'The URL path you provided could not be read. Please ensure that it is properly formed according to the solution documentation.'
        });
    }

    /**
     * Returns a formatted image source bucket whitelist as specified in the
     * SOURCE_BUCKETS environment variable of the image handler Lambda
     * function. Provides error handling for missing/invalid values.
     */
    getAllowedSourceBuckets() {
        const sourceBuckets = process.env.SOURCE_BUCKETS;
        if (sourceBuckets !== undefined) {
            const formattedBuckets = sourceBuckets.replace(/\s+/g, '');
            return formattedBuckets.split(',');
        }

        throw ({
            status: 400,
            code: 'GetAllowedSourceBuckets::NoSourceBuckets',
            message: 'The SOURCE_BUCKETS variable could not be read. Please check that it is not empty and contains at least one source bucket, or multiple buckets separated by commas. Spaces can be provided between commas and bucket names, these will be automatically parsed out when decoding.'
        });
    }
}

// Exports
module.exports = ImageRequest;
