const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: "dnlyiz5ck",
  api_key: "391214394869519",
  api_secret: "SQ0GxDz_58tNPoSp-WpM2gYB2EE",
});

async function main() {
  console.log("Uploading sample image...");
  const uploadResult = await cloudinary.uploader.upload(
    "https://res.cloudinary.com/demo/image/upload/sample.jpg",
    { public_id: "everlast_test_sample" },
  );

  console.log("Secure URL:", uploadResult.secure_url);
  console.log("Public ID: ", uploadResult.public_id);

  const details = await cloudinary.api.resource(uploadResult.public_id);
  console.log("Width:     ", details.width);
  console.log("Height:    ", details.height);
  console.log("Format:    ", details.format);
  console.log("Size:      ", details.bytes, "bytes");

  // f_auto: picks the best format for the browser (WebP, AVIF, etc.)
  // q_auto: reduces file size automatically while keeping visual quality
  const transformedUrl = cloudinary.url(uploadResult.public_id, {
    transformation: [{ fetch_format: "auto", quality: "auto" }],
    secure: true,
  });

  console.log("\nDone! Click link below to see optimized version of the image. Check the size and the format.");
  console.log(transformedUrl);
}

main().catch(console.error);
