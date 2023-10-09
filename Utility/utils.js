const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");

const s3 = new AWS.S3({
  //   endpoint: "http://localhost:4566",
  s3ForcePathStyle: true, // needed with minio?
  accessKeyId: "YOUR-ACCESSKEYID", // access key id (fake works)
  secretAccessKey: "YOUR-SECRETACCESSKEY", // secret access key (fake works)
  endpoint: new AWS.Endpoint("http://localhost:4566"), // point to localstack
  sslEnabled: false, // disable SSL
  region: "us-east-1",
});

exports.saveToS3 = async (bucketName, data) => {
  const s3Key = `${uuidv4()}.txt`;
  const s3params = {
    Bucket: bucketName, // Replace with your S3 bucket name
    Key: s3Key,
    Body: data,
    ContentType: "text/plain",
  };
  await s3.putObject(s3params).promise();

  // Generate S3 URI
  const s3Uri = `s3://webpages-blob/${s3Key}`;

  return s3Uri;
};

exports.cleanCachedString = (data) => {
  return data.replace(/\\(['"])/g, "$1");
};
