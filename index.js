import openai from "./config/open-ai.js";
import readlineSync from "readline-sync";
import colors from "colors";
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url"; // Needed for __dirname fix
import pdfParse from "pdf-parse";
import mammoth from "mammoth"; // Import mammoth for .docx files
import xlsx from "xlsx";

// Manual __dirname definition
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: "uploads/" }); // Upload folder for storing files

// Promisify fs.readFile for easier async usage
const readFileAsync = promisify(fs.readFile);

// Parse JSON body
app.use(express.json());

// API to upload resume and ask questions
app.post("/upload-resume", upload.single("file"), async (req, res) => {
  const { question } = req.body;
  let filePath;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a file." });
    }

    // Get file path
    filePath = path.join(__dirname, "uploads", req.file.filename);

    let fileContent;

    // Handle different file types
    const fileType = req.file.mimetype;

    if (fileType === "text/plain") {
      fileContent = await readFileAsync(filePath, "utf-8");
    } else if (fileType === "application/pdf") {
      const fileBuffer = await readFileAsync(filePath); // Read file buffer
      const pdfData = await pdfParse(fileBuffer);
      fileContent = pdfData.text;

      if (!fileContent) {
        return res
          .status(400)
          .json({ error: "Could not extract text from the PDF." });
      }
    } else if (
      fileType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileType === "application/msword"
    ) {
      const fileBuffer = await readFileAsync(filePath); // Read file buffer
      const mammothData = await mammoth.extractRawText({ buffer: fileBuffer });
      fileContent = mammothData.value;

      if (!fileContent) {
        return res
          .status(400)
          .json({ error: "Could not extract text from the Word document." });
      }
    } else if (
      fileType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      fileType === "application/vnd.ms-excel"
    ) {
      const workbook = xlsx.readFile(filePath); // Read Excel file
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      fileContent = xlsx.utils.sheet_to_csv(sheet); // Convert to CSV for readable content

      // Images (jpeg, png, etc.)
    } else if (fileType.startsWith("image/")) {
      fileContent = `An image file (${req.file.originalname}) was uploaded.`;

      // Video files
    } else if (fileType.startsWith("video/")) {
      fileContent = `A video file (${req.file.originalname}) was uploaded.`;

      // Other unsupported file types
    } else {
      return res
        .status(400)
        .json({ error: `Unsupported file type: ${fileType}` });
    }

    // Ask OpenAI the question with the resume data
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      // model: 'gpt-4',
      messages: [
        {
          role: "user",
          content: `${fileContent}\n\nQuestion: ${question}`,
        },
      ],
    });

    // Get completion text
    const completionText = completion.data.choices[0].message.content;

    // Return the response from OpenAI
    res.json({ response: completionText });
  } catch (error) {
    console.error(colors.red(error));
    res
      .status(500)
      .json({ error: "Something went wrong, please try again later." });
  } finally {
    // Clean up the uploaded file after processing or in case of error
    if (filePath) {
      fs.unlinkSync(filePath);
    }
  }
});

// function to work as chat bot
async function main() {
  console.log(colors.bold.green("Welcome to the Chatbot Program!"));
  console.log(colors.bold.green("You can start chatting with the bot."));

  const chatHistory = []; // Store conversation history

  while (true) {
    const userInput = readlineSync.question(colors.yellow("You: "));

    try {
      // Construct messages by iterating over the history
      const messages = chatHistory.map(([role, content]) => ({
        role,
        content,
      }));

      // Add latest user input
      messages.push({ role: "user", content: userInput });

      // Call the API with user input & history
      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: messages,
      });

      // Get completion text/content
      const completionText = completion.data.choices[0].message.content;

      if (userInput.toLowerCase() === "exit") {
        console.log(colors.green("Bot: ") + completionText);
        return;
      }

      console.log(colors.green("Bot: ") + completionText);

      // Update history with user input and assistant response
      chatHistory.push(["user", userInput]);
      chatHistory.push(["assistant", completionText]);
    } catch (error) {
      if (error.response) {
        console.error(colors.red(error.response.data.error.code));
        console.error(colors.red(error.response.data.error.message));
        return;
      }
      console.error(colors.red(error));
      return;
    }
  }
}

// main();

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(colors.bold.green(`Server running on port ${PORT}`));
});
