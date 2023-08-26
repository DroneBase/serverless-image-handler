# Image Handler

Takes a request input in the form:

```json
{
  "bucket": "dronebase-production",
  "key": "assets/mission/images/52697471-8332f7c4df712a509c77fc28a86a223837bd15a4/original-917d1f691173656dc6dd8b47d9a8b7b0286c22b5.jpg",
  "edit": {}
}
```

For images larges than 6mb, the Lambda function URL must be used. This will stream the response and allow for image up to a soft limit of 20mb in size. The streaming URL can be found in the AWS console under `Lambda > Functions > <Your Function Name>` then under "Function Overview" in the "Function URL" field. If the field is empty that means the Lambda function isn't configured to being invoked directly from a URL and must be accessed through AWS API gateway.
```
https://<id>.lambda-url.<region>.on.aws/resized_image/
```

## Build

Build the SAM stack in a container. M1/M2 mac are not able to build the sharpJS library currently so building within a container is required.

```bash
sam build --use-container
```


## Deploy
Deploy the SAM stack for the specified env. See `samconfig.toml` for env specific details.
```bash
sam deploy --config-env <dev | prod>
```


## Cleanup

Delete the entire SAM stack.

```bash
sam delete
```
