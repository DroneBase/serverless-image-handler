jest.mock('aws-sdk/clients/s3', () =>
    jest.fn().mockImplementation(() => ({
        getObject: () => ({
            promise: () => Promise.resolve({ Body: Buffer.from('image-bytes') })
        })
    }))
);

const ImageRequest = require('../image-request.js');

const REQUEST = {
    bucket: 'dronebase-staging',
    key: 'site/asset/photo.jpg',
    edits: { resize: { width: 300 } }
};

const encode = (request) => Buffer.from(JSON.stringify(request)).toString('base64');

// The image request travels as base64-encoded JSON in the JWT's `request`
// claim, matching the format the Default (path-based) route already uses.
const tokenEvent = (request = REQUEST) => ({
    requestContext: {
        authorizer: {
            jwt: {
                claims: { request: encode(request) }
            }
        }
    }
});

// The Default route carries the same base64-encoded JSON as the last segment
// of the URL path.
const pathEvent = (request = REQUEST) => ({
    path: `/${encode(request)}`
});

beforeEach(() => {
    process.env.SOURCE_BUCKETS = 'dronebase-development, dronebase-staging';
});

describe('Token request route', () => {
    it('identifies a validated JWT event as a Token request', () => {
        const imageRequest = new ImageRequest();
        expect(imageRequest.parseRequestType(tokenEvent())).toEqual('Token');
    });

    it('decodes the image request from the JWT claim', () => {
        const imageRequest = new ImageRequest();
        expect(imageRequest.decodeRequest(tokenEvent())).toEqual(REQUEST);
    });

    it('resolves bucket, key and edits from the claim', async () => {
        const imageRequest = new ImageRequest();
        await imageRequest.setup(tokenEvent());

        expect(imageRequest.requestType).toEqual('Token');
        expect(imageRequest.bucket).toEqual('dronebase-staging');
        expect(imageRequest.key).toEqual('site/asset/photo.jpg');
        expect(imageRequest.edits).toEqual({ resize: { width: 300 } });
    });
});

describe('Default request route', () => {
    it('identifies a base64 path event as a Default request', () => {
        const imageRequest = new ImageRequest();
        expect(imageRequest.parseRequestType(pathEvent())).toEqual('Default');
    });

    it('decodes the image request from the URL path', () => {
        const imageRequest = new ImageRequest();
        expect(imageRequest.decodeRequest(pathEvent())).toEqual(REQUEST);
    });

    it('resolves bucket, key and edits from the path', async () => {
        const imageRequest = new ImageRequest();
        await imageRequest.setup(pathEvent());

        expect(imageRequest.requestType).toEqual('Default');
        expect(imageRequest.bucket).toEqual('dronebase-staging');
        expect(imageRequest.key).toEqual('site/asset/photo.jpg');
        expect(imageRequest.edits).toEqual({ resize: { width: 300 } });
    });
});