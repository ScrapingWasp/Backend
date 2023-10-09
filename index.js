const dotenv = require("dotenv");
const express = require("express");
const { chromium } = require("playwright");
const morgan = require("morgan");
const helmet = require("helmet");
const dynamoose = require("dynamoose");
const { v4: uuidv4 } = require("uuid");
const Webpage = require("./Models/Webpage");
const AWS = require("aws-sdk");
// const redis = require("./Utility/redisConnector");

dotenv.config();

const cookieParser = require("cookie-parser");
const { saveToS3, cleanCachedString } = require("./Utility/utils");

const app = express();

const ddb = new dynamoose.aws.ddb.DynamoDB(
  process.env.ENV === "dev"
    ? {
        endpoint: "http://localhost:4566",
        credentials: {
          accessKeyId: "mykey",
          secretAccessKey: "mykey",
        },
        region: process.env.AWS_REGION,
      }
    : {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
        region: process.env.AWS_REGION,
      }
);

dynamoose.aws.ddb.set(ddb);

app.set("trust proxy", true);

app.use(helmet());

app.use(morgan("dev"));
app.use(
  express.json({
    limit: process.env.MAX_BODY_SIZE_EXPRESS,
  })
);

app.use(cookieParser());

app.get("/v2/general", async (req, res) => {
  const { url } = req.body;
  const apiKey = req.get("x-api-key");

  console.log(url, apiKey);

  // Check if API key and URL are provided
  if (!url || !apiKey) {
    return res
      .status(400)
      .json({ error: "Missing required parameters or API key" });
  }

  // Validate API key
  if (apiKey !== process.env.WASP_API_KEY) {
    return res.status(403).json({ error: "Invalid API Key" });
  }

  // Check cache
  // const cachedData = await redis.get(url);
  // if (cachedData) {
  //   // console.log(cleanCachedString(cachedData));
  //   return res.json({ url, page: cleanCachedString(cachedData) });
  // }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  context.on("request", (request) => {
    console.log(`🚀 Request made: ${request.method()} ${request.url()}`);
  });

  context.on("requestfailed", (request) => {
    console.log(
      `❌ Request failed: ${request.method()} ${request.url()} - ${
        request.failure().errorText
      }`
    );
  });

  context.on("response", (response) => {
    console.log(
      `🆗 Response received: ${response
        .request()
        .method()} ${response.url()} - ${response.status()}`
    );
  });

  const page = await context.newPage();

  try {
    console.log("Waiting for the page to load....");
    await page.goto(url, { waitUntil: "networkidle0", timeout: 0 });

    const pageContent = await page.content();
    const pageTitle = await page.title();
    const pageDescription = await page.$eval(
      'meta[name="description"]',
      (element) => element.content
    );

    // Store to cache for 1 hours
    // await redis.set(url, pageContent, "EX", 3600);

    //Save the webpage to DynamoDB, it it already exists, update
    const checkWebsite = await Webpage.query("url").eq(url).exec();

    if (checkWebsite.count <= 0) {
      const s3Ref = await saveToS3("webpages-blob", pageContent);

      const webpage = new Webpage({
        id: uuidv4(),
        url,
        title: pageTitle,
        description: pageDescription,
        content_uri: s3Ref,
      });

      await webpage.save();
    } else {
      const s3Ref = await saveToS3("webpages-blob", pageContent);

      if (checkWebsite[0]?.id)
        await Webpage.update(
          { id: checkWebsite[0]?.id },
          {
            title: pageTitle,
            description: pageDescription,
            content_uri: s3Ref,
          }
        );
    }

    return res.json({ url, page: pageContent });
  } catch (error) {
    console.error("Error fetching page:", error.message);
    console.log(error);
    return res.status(500).json({ error: "Failed to fetch page" });
  } finally {
    await browser.close();
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);
});
