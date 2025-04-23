const express = require("express");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const multer = require("multer");

const fs = require("fs");

const path = require("path");

const cors = require("cors");

const app = express();

const port = 3000;

// Configure Google AI

const genAI = new GoogleGenerativeAI("AIzaSyB0UybQU1-akrq4VRu3BMpovhW9oDkl4No");

// Configure multer for handling file uploads

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "./uploads";

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }

    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,

  fileFilter: (req, file, cb) => {
    const allowedTypes = [".jpg", ".jpeg", ".png"];

    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPG, JPEG, and PNG are allowed."));
    }
  },

  limits: {
    files: 10,

    fileSize: 5 * 1024 * 1024,
  },
});

async function fileToGenerativePart(filePath) {
  const buffer = await fs.promises.readFile(filePath);

  return {
    inlineData: {
      data: buffer.toString("base64"),

      mimeType: "image/jpeg",
    },
  };
}

async function cleanupFiles(files) {
  for (const file of files) {
    try {
      await fs.promises.unlink(file.path);
    } catch (error) {
      console.error(`Error deleting file ${file.path}:`, error);
    }
  }
}

app.use(
  cors({
    origin: "*", // Be more specific in production
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Accept"],
  })
);

app.use(express.json());

app.use(express.static("public"));

app.post("/analyze-wardrobe", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const {
      occasion = "party",
      skin_tone = "fair",
      gender = "male",
      available_shirts = "[]",
      available_pants = "[]",
    } = req.body;

    const shirts = JSON.parse(available_shirts);
    const pants = JSON.parse(available_pants);

    const imageParts = await Promise.all(
      req.files.map((file) => fileToGenerativePart(file.path))
    );

    const prompt = `
      You are a professional fashion stylist. Create an outfit using ONLY the available clothing items provided.

      Available tops: ${shirts.join(", ")}
      Available bottoms: ${pants.join(", ")}

      Key details:
      - Occasion: ${occasion}
      - Skin Tone: ${skin_tone}
      - Gender: ${gender}
      
      IMPORTANT: You must ONLY suggest items from the available lists above.
      
      Provide your response in this exact JSON format:
      {
        "outfit": {
          "top": "exact_name_from_available_tops",
          "bottom": "exact_name_from_available_bottoms"
        },
        "reason": "Detailed explanation of why this combination works well together",
        "occasion_suitability": "Explanation of how well this outfit matches the specified occasion"
      }

      Important:
      1. Keep the response strictly in valid JSON format
      2. Use the exact keys shown above
      3. The "top" and "bottom" values MUST exactly match names from the available lists
      4. Do not add any additional descriptions to the item names
    `;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent([prompt, ...imageParts]);

    const response = await result.response;

    const text = response.text();

    // Try to extract JSON from the response

    const jsonMatch = text.match(/\{[\s\S]*\}/);

    let parsedResponse;

    if (jsonMatch) {
      try {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error("JSON parsing error:", parseError);

        // Fallback to structured response

        parsedResponse = {
          outfit: {
            top: text.includes("top")
              ? text
                  .split("top")[1]
                  .split("\n")[0]
                  .replace(/[":,}]/g, "")
                  .trim()
              : "Unable to parse top suggestion",

            bottom: text.includes("bottom")
              ? text
                  .split("bottom")[1]
                  .split("\n")[0]
                  .replace(/[":,}]/g, "")
                  .trim()
              : "Unable to parse bottom suggestion",

            shoes: text.includes("shoes")
              ? text
                  .split("shoes")[1]
                  .split("\n")[0]
                  .replace(/[":,}]/g, "")
                  .trim()
              : "Unable to parse shoes suggestion",

            accessories: text.includes("accessories")
              ? text
                  .split("accessories")[1]
                  .split("\n")[0]
                  .replace(/[":,}]/g, "")
                  .trim()
              : "Unable to parse accessories suggestion",
          },

          reason: text.includes("reason")
            ? text
                .split("reason")[1]
                .split("\n")[0]
                .replace(/[":,}]/g, "")
                .trim()
            : "Unable to parse styling rationale",

          occasion_suitability: text.includes("occasion_suitability")
            ? text
                .split("occasion_suitability")[1]
                .split("\n")[0]
                .replace(/[":,}]/g, "")
                .trim()
            : "Unable to parse occasion suitability",
        };
      }
    } else {
      parsedResponse = {
        outfit: {
          top: "AI response format error",

          bottom: "AI response format error",

          shoes: "AI response format error",

          accessories: "AI response format error",
        },

        reason:
          "The AI response was not in the expected format. Please try again.",

        occasion_suitability:
          "Unable to determine due to response format error",
      };
    }

    await cleanupFiles(req.files);

    res.json(parsedResponse);
  } catch (error) {
    if (req.files) {
      await cleanupFiles(req.files);
    }

    console.error("Error:", error);

    res.status(500).json({
      error: "Internal server error",

      details: error.message,
    });
  }
});

app.use((error, req, res, next) => {
  console.error(error);

  res.status(500).json({
    error: "Internal server error",

    details: error.message,
  });
});

app.listen(port, () => {
  console.log(`Wardrobe analyzer API running on port ${port}`);
});
