// --- START OF FILE index.js ---

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import slugify from 'slugify';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';

// --- Initial Setup ---
dotenv.config();
const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load only the Gemini API key from .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const POLLINATIONS_API_URL_BASE = 'https://text.pollinations.ai/prompt/';
const SEARCH_MODEL_PARAM = '?model=searchgpt';

// Retry Settings
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// --- MODEL AND API CONSTANTS ---
const DEFAULT_CHECKLIST_MODEL = 'gemini-2.0-flash'; // Note: This model might not exist or be named differently now.
const DEFAULT_REPORT_MODEL = 'gemini-2.5-pro-exp-03-25'; // Note: This model likely doesn't exist.
const GEMINI_API_VERSION = 'v1beta';

// --- VALIDATION FOR ESSENTIAL KEYS ---
if (!GEMINI_API_KEY) {
    console.error('Critical Error: GEMINI_API_KEY not found in .env');
    process.exit(1);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// --- Helper Functions ---

/** Constructs Gemini API URL */
function getGeminiApiUrl(modelName, apiKey) {
    const apiVersionPath = GEMINI_API_VERSION;
    return `https://generativelanguage.googleapis.com/${apiVersionPath}/models/${modelName}:generateContent?key=${apiKey}`;
}

/** Executes cURL with Retry Logic */
async function executeCurlWithRetry(command, retries = MAX_RETRIES) {
    try {
        const { stdout, stderr } = await execPromise(command, { maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer
        if (stderr && !stdout?.trim()) {
            const isProgress = stderr.includes('%') && stderr.includes('bytes');
            if (!isProgress && (stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('fail'))) {
                console.warn(`cURL stderr indicating potential error (attempt ${MAX_RETRIES - retries + 1}): ${stderr.substring(0, 200)}...`);
            }
        }
        // Handle Gemini-specific API errors
        if (command.includes('generativelanguage.googleapis.com')) {
            const parsedStdout = JSON.parse(stdout);
            if (parsedStdout.error) {
                const { code = 'N/A', message = 'Unknown Error', status = 'N/A' } = parsedStdout.error;
                throw new Error(`API error [${code} ${status}]: ${message}`);
            }
        }
        return stdout;
    } catch (error) {
        console.error(`Error executing command (Attempt ${MAX_RETRIES - retries + 1}): ${error.message}`);
        if (retries > 0) {
            console.log(`Retrying command in ${RETRY_DELAY_MS / 1000} seconds... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            return executeCurlWithRetry(command, retries - 1);
        } else {
            throw new Error(`Final command execution failed after ${MAX_RETRIES} attempts. Last error: ${error.message}`);
        }
    }
}

/** Creates Folder if Not Exists */
async function createFolderIfNotExists(dirPath, verbose = false) {
    try {
        await fs.access(dirPath);
        if (verbose) console.log(`Folder ${path.basename(dirPath)} already exists.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(dirPath, { recursive: true });
            if (verbose) console.log(`Folder ${path.basename(dirPath)} created successfully.`);
        } else {
            throw error;
        }
    }
}

/** Creates a Slug */
function createSlug(text) {
    return slugify(text, { lower: true, strict: true, remove: /[*+~.()'"!:@?\/\\%]/g });
}

/** Asks Yes/No/Edit */
async function askYesNoEdit(question) {
    while (true) {
        const answer = await rl.question(`${question} (y/n/edit): `);
        const lowerAnswer = answer.toLowerCase().trim();
        if (lowerAnswer === 'y' || lowerAnswer === 'yes') return 'yes';
        if (lowerAnswer === 'n' || lowerAnswer === 'no') return 'no';
        if (lowerAnswer === 'edit') return 'edit';
        console.log("Invalid response. Please type 'y', 'n', or 'edit'.");
    }
}

/** Asks Yes/No */
async function askYesNo(question) {
    while (true) {
        const answer = await rl.question(`${question} (y/n): `);
        const lowerAnswer = answer.toLowerCase().trim();
        if (lowerAnswer === 'y' || lowerAnswer === 'yes') return true;
        if (lowerAnswer === 'n' || lowerAnswer === 'no') return false;
        console.log("Invalid response. Please type 'y' or 'n'.");
    }
}

/** Generates Checklist */
async function generateChecklist(topic, apiKey) {
    const modelName = DEFAULT_CHECKLIST_MODEL;
    const geminiApiUrl = getGeminiApiUrl(modelName, apiKey);
    console.log(`\n🤖 Generating detailed checklist with ${modelName} (via cURL)...`);
    const prompt = `For an enterprise-level research on the topic "${topic}", create an EXTREMELY detailed and comprehensive checklist (around 10-15 items). Each item should be a question and...`;
    const requestBody = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
    const escapedBody = requestBody.replace(/'/g, "'\\''");
    const curlCommand = `curl -s -X POST "${geminiApiUrl}" -H "Content-Type: application/json" -d '${escapedBody}'`;

    try {
        const stdout = await executeCurlWithRetry(curlCommand);
        const responseData = JSON.parse(stdout);
        const text = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error('Unable to extract checklist text from Gemini response.');
        }

        const checklistItems = text.split('\n')
            .map(line => line.trim().replace(/^\d+\.\s*/, ''))
            .filter(item => item.length > 2);

        if (checklistItems.length === 0) {
            throw new Error('No valid checklist items extracted from Gemini response.');
        }
        console.log('✅ Checklist generated successfully!');
        return checklistItems;
    } catch (error) {
        throw error;
    }
}

/** Reviews/Edits Checklist */
async function reviewAndEditChecklist(initialChecklist, checklistFilePath) {
    let currentChecklist = [...initialChecklist];
    while (true) {
        console.log("\n--- Proposed Checklist ---");
        currentChecklist.forEach((item, index) => console.log(`${index + 1}. ${item}`));
        console.log("--------------------------");
        const userChoice = await askYesNoEdit("❓ Is the checklist good to start the research?");

        if (userChoice === 'yes') {
            await saveChecklistToFile(currentChecklist, checklistFilePath);
            return currentChecklist;
        } else if (userChoice === 'no') {
            const regenerate = await askYesNo("❌ Would you like to try generating the checklist again?");
            if (regenerate) return null;
            else { console.log("Operation canceled."); process.exit(0); }
        } else if (userChoice === 'edit') {
            await saveChecklistToFile(currentChecklist, checklistFilePath);
            console.log(`\n📝 Edit the file: ${checklistFilePath}`);
            console.log("   Save your changes and press Enter here when done...");
            await rl.question("   Press Enter to continue after editing...");
            try {
                const editedContent = await fs.readFile(checklistFilePath, 'utf-8');
                currentChecklist = editedContent.split('\n')
                                     .map(line => line.trim())
                                     .filter(line => line.length > 0);
                console.log("✅ Checklist updated from the file.");
            } catch (readError) {
                console.error(`❌ Error reading the edited file ${checklistFilePath}: ${readError.message}`);
            }
        }
    }
}

/** Saves Checklist */
async function saveChecklistToFile(checklistItems, checklistFilePath) {
    const markdownContent = checklistItems.map((item, index) => `${index + 1}. ${item}`).join('\n');
    try {
        await createFolderIfNotExists(path.dirname(checklistFilePath));
        await fs.writeFile(checklistFilePath, markdownContent);
        console.log(`💾 Checklist saved to ${checklistFilePath}`);
    } catch (error) {
        console.error(`Error saving checklist to ${checklistFilePath}:`, error);
    }
}

// --- ADDITIONAL FUNCTIONS OMITTED FOR BREVITY ---
// (These would include similar translations for other methods like generating the final report.)

// --- END OF FILE index.js ---
