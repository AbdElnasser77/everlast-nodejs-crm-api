const cloudinary = require("../../utils/cloudinary");
const AppError = require("../../utils/AppError");
const { getResourceType, getMessageType } = require("../../utils/mediaHelpers");

const uploadMedia = (req, res, next) => {
  if (!req.file) return next(new AppError("No file provided", 400));

  const resourceType = getResourceType(req.file.mimetype);
  const messageType = getMessageType(req.file.mimetype);

  const uploadStream = cloudinary.uploader.upload_stream(
    {
      resource_type: resourceType,
      folder: "everlast-crm",
    },
    (error, result) => {
      if (error) {
        console.error("Cloudinary upload error:", error.message);
        return next(new AppError("File upload failed", 502));
      }

      res.status(200).json({
        success: true,
        url: result.secure_url,
        publicId: result.public_id,
        messageType,
        format: result.format,
        bytes: result.bytes,
      });
    },
  );

  uploadStream.end(req.file.buffer);
};

module.exports = { uploadMedia };
