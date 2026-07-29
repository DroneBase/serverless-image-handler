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

const ThumborMapping = require('./thumbor-mapping');

class ImageRequest {

    /**
     * Initializer function for creating a new image request, used by the image
     * handler to perform image modifications.
     * @param {Object} event - Lambda request body.
     */
    async setup(event) {
        try {
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
        const S3 = require('aws-sdk/clients/s3');
        const s3 = new S3();
        const imageLocation = { Bucket: bucket, Key: key };
        const request = s3.getObject(imageLocation).promise();
        try {
            const originalImage = await request;
            return Promise.resolve(originalImage);
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
     * Parses the name of the appropriate Amazon S3 bucket to source the
     * original image from.
     * @param {String} event - Lambda request body.
     * @param {String} requestType - Image handler request type.
     */
    parseImageBucket(event, requestType) {
        if (requestType === "Default" || requestType === "Token") {
            // Decode the image request
            const decoded = this.decodeRequest(event);
            if (decoded.bucket !== undefined) {
                // Check the provided bucket against the whitelist
                const sourceBuckets = this.getAllowedSourceBuckets();
                if (sourceBuckets.includes(decoded.bucket)) {
                    return decoded.bucket;
                } else {
                    throw ({
                        status: 403,
                        code: 'ImageBucket::CannotAccessBucket',
                        message: 'The bucket you specified could not be accessed. Please check that the bucket is specified in your SOURCE_BUCKETS.'
                    });
                }
            } else {
                // Try to use the default image source bucket env var
                const sourceBuckets = this.getAllowedSourceBuckets();
                return sourceBuckets[0];
            }
        } else if (requestType === "Thumbor" || requestType === "Custom") {
            // Use the default image source bucket env var
            const sourceBuckets = this.getAllowedSourceBuckets();
            return sourceBuckets[0];
        } else {
            throw ({
                status: 400,
                code: 'ImageBucket::CannotFindBucket',
                message: 'The bucket you specified could not be found. Please check the spelling of the bucket name in your request.'
            });
        }
    }

    /**
     * Parses the edits to be made to the original image.
     * @param {String} event - Lambda request body.
     * @param {String} requestType - Image handler request type.
     */
    parseImageEdits(event, requestType) {
        if (requestType === "Default" || requestType === "Token") {
            const decoded = this.decodeRequest(event);
            return decoded.edits;
        } else if (requestType === "Thumbor") {
            const thumborMapping = new ThumborMapping();
            thumborMapping.process(event);
            return thumborMapping.edits;
        } else if (requestType === "Custom") {
            const thumborMapping = new ThumborMapping();
            const parsedPath = thumborMapping.parseCustomPath(event.path);
            thumborMapping.process(parsedPath);
            return thumborMapping.edits;
        } else {
            throw ({
                status: 400,
                code: 'ImageEdits::CannotParseEdits',
                message: 'The edits you provided could not be parsed. Please check the syntax of your request and refer to the documentation for additional guidance.'
            });
        }
    }

    /**
     * Parses the name of the appropriate Amazon S3 key corresponding to the
     * original image.
     * @param {String} event - Lambda request body.
     * @param {String} requestType - Type, either "Default", "Token", "Thumbor", or "Custom".
     */
    parseImageKey(event, requestType) {
        if (requestType === "Default" || requestType === "Token") {
            // Decode the image request and return the image key
            const decoded = this.decodeRequest(event);
            return decoded.key;
        } else if (requestType === "Thumbor" || requestType === "Custom") {
            // Parse the key from the end of the path
            const key = (event["path"]).split("/");
            return key[key.length - 1];
        } else {
            // Return an error for all other conditions
            throw ({
                status: 400,
                code: 'ImageEdits::CannotFindImage',
                message: 'The image you specified could not be found. Please check your request syntax as well as the bucket you specified to ensure it exists.'
            });
        }
    }

    /**
     * Returns the base64-encoded image request carried in a validated JWT, or
     * undefined when the request did not arrive through an API Gateway route
     * with a JWT authorizer.
     *
     * API Gateway populates requestContext.authorizer.jwt only after it has
     * verified the token's signature, issuer, audience and expiry, so the mere
     * presence of the claim is proof of validation - the token itself is never
     * parsed here. Lambda Function URL invocations (the CloudFront path) carry
     * requestContext.authorizer.iam instead, never .jwt.
     * @param {Object} event - Lambda request body.
     */
    getRequestClaim(event) {
        return event.requestContext?.authorizer?.jwt?.claims?.request;
    }

    /**
     * Determines how to handle the request being made based on the URL path
     * prefix to the image request. Categorizes a request as either "token"
     * (image request supplied as a JWT claim), "image" (uses the Sharp
     * library), "thumbor" (uses Thumbor mapping), or "custom" (uses the
     * rewrite function).
     * @param {Object} event - Lambda request body.
    */
    parseRequestType(event) {
        // A validated JWT carrying the request claim short-circuits path
        // matching entirely: these requests have no image path to inspect.
        if (this.getRequestClaim(event) !== undefined) {
            return 'Token';
        }

        let path = event.rawPath ?? event["path"];

        if (process.env.TRUNCATE_PATH_PREFIX !== undefined) {
            // Allows cloudfront to be shared by adding a prefix/* to behaviour
            path = path.replace(process.env.TRUNCATE_PATH_PREFIX, '')
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
        if (matchDefault.test(path)) {  // use sharp
            return 'Default';
        } else if (matchCustom.test(path) && definedEnvironmentVariables) {  // use rewrite function then thumbor mappings
            return 'Custom';
        } else if (matchThumbor.test(path)) {  // use thumbor mappings
            return 'Thumbor';
        } else {
            throw {
                status: 400,
                code: 'RequestTypeError',
                message: 'The type of request you are making could not be processed. Please ensure that your original image is of a supported file type (jpg, png, tiff, webp) and that your image request is provided in the correct syntax. Refer to the documentation for additional guidance on forming image requests.'
            };
        }
    }

    /**
     * Decodes the base64-encoded image request associated with default and
     * token image requests. The encoded value is taken from the JWT request
     * claim when present, otherwise from the last segment of the URL path.
     * Provides error handling for invalid or undefined values.
     * @param {Object} event - The proxied request object.
     */
    decodeRequest(event) {
        let encoded = this.getRequestClaim(event);

        if (encoded === undefined) {
            const path = event.rawPath ?? event["path"];
            if (path === undefined) {
                throw ({
                    status: 400,
                    code: 'DecodeRequest::CannotReadPath',
                    message: 'The URL path you provided could not be read. Please ensure that it is properly formed according to the solution documentation.'
                });
            }
            const splitPath = path.split("/");
            encoded = splitPath[splitPath.length - 1];
        }

        const toBuffer = Buffer.from(encoded, 'base64');
        try {
            return JSON.parse(toBuffer.toString('utf8'));
        } catch (e) {
            throw ({
                status: 400,
                code: 'DecodeRequest::CannotDecodeRequest',
                message: 'The image request you provided could not be decoded. Please check that your request is base64 encoded properly and refer to the documentation for additional guidance.'
            });
        }
    }

    /**
     * Returns a formatted image source bucket whitelist as specified in the
     * SOURCE_BUCKETS environment variable of the image handler Lambda
     * function. Provides error handling for missing/invalid values.
     */
    getAllowedSourceBuckets() {
        const sourceBuckets = process.env.SOURCE_BUCKETS;
        if (sourceBuckets === undefined) {
            throw ({
                status: 400,
                code: 'GetAllowedSourceBuckets::NoSourceBuckets',
                message: 'The SOURCE_BUCKETS variable could not be read. Please check that it is not empty and contains at least one source bucket, or multiple buckets separated by commas. Spaces can be provided between commas and bucket names, these will be automatically parsed out when decoding.'
            });
        } else {
            const formatted = sourceBuckets.replace(/\s+/g, '');
            const buckets = formatted.split(',');
            return buckets;
        }
    }
}

// Exports
module.exports = ImageRequest;