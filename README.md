# Advanced Business Research Assistant (vCurl - Text Only)

## Description

This Node.js script serves as an advanced assistant for conducting business research. It leverages AI models (Google Gemini and Pollinations) via cURL commands to automate the process of generating research checklists, performing individual text-based searches based on the checklist, gathering source materials, and compiling a comprehensive final report. The script interacts with the user through the command line to define the research topic, review generated checklists, and manage the workflow.

## Features

- **Interactive CLI:** Guides the user through the research process via command-line prompts.
- **Topic-Based Organization:** Automatically creates a dedicated folder structure for each research topic.
- **AI-Powered Checklist Generation:** Uses the Google Gemini API to generate a detailed initial research checklist based on the provided topic.
- **Checklist Review & Editing:** Allows the user to review, approve, or edit the generated checklist before proceeding.
- **Automated Text Search:** Performs individual web searches for each checklist item using the Pollinations Search API (`text.pollinations.ai`).
- **Individual Result Saving:** Saves the text results of each search into separate `.txt` files within the results folder.
- **Source Material Integration:** Allows users to add their own context or source files (`.txt`, `.md`) to a dedicated `sources` folder, which are then incorporated into the final report generation.
- **AI-Powered Report Generation:** Utilizes a specified Google Gemini model to synthesize the collected search results and user-provided source materials into a comprehensive final report in Markdown format.
- **API Call Retries:** Implements a retry mechanism with delays for cURL commands to handle transient network or API issues.
- **Gemini API Error Handling:** Includes specific checks for common Gemini API errors like content blocking, rate limits, and empty responses.
- **File Management:** Handles the creation and saving of checklist, search result, and final report files.

## Prerequisites

- **Node.js:** The script is written in JavaScript and requires the Node.js runtime. (Tested with Node.js v20.x, but likely compatible with recent LTS versions).
- **npm:** Node Package Manager, used for installing dependencies. It's typically included with Node.js installations.
- **cURL:** The script relies heavily on the `curl` command-line tool to make API requests. Ensure `curl` is installed and accessible in your system's PATH.
- **Text Editor:** A text editor is needed if you choose to manually edit the generated checklist.

## Installation

1. **Download the Script File (**``**):**\
   Instead of cloning a repository, simply download the file directly to your project directory. You can use the following command:

   ```bash
   curl -O https://your-server.com/path/to/index.js
   ```

   This ensures a clean setup without unnecessary folders.

2. **Install Dependencies:** Navigate to the directory containing `index.js` in your terminal and run:

   ```bash
   npm install dotenv slugify
   ```

   - `dotenv`: Loads environment variables from a `.env` file.
   - `slugify`: Used to create safe filenames from the research topic.

## Configuration

1. **Create **``** file:** In the same directory as `index.js`, create a file named `.env`.
2. **Add API Key:** Open the `.env` file and add your Google Gemini API key:
   ```dotenv
   GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
   ```
   Replace `YOUR_GEMINI_API_KEY_HERE` with your actual API key.
   - **Important:** The script *only* requires the `GEMINI_API_KEY`. It does not use or require Google Search API keys or Custom Search Engine IDs.
   - Ensure the `.env` file is never committed to version control (e.g., add it to your `.gitignore` file).

## Usage

1. **Run the Script:** Open your terminal, navigate to the directory containing `index.js` and the `.env` file, and execute:

   ```bash
   node index.js
   ```

2. **Enter Research Topic:** The script will prompt you to enter the central topic for your research.

   ```
   ❓ What is the central topic of your research?
   ```

3. **Choose Report Model:** You'll be asked to specify the Google Gemini model to use for generating the final report. Press Enter to use the default (`gemini-2.5-pro-exp-03-25`).

   ```
   🤖 Gemini model for report? (Enter=DEFAULT_REPORT_MODEL):
   ```

4. **Review/Edit Checklist:**

   - The script generates an initial checklist using the default checklist model (`gemini-2.0-flash`).
   - The checklist is displayed.
   - You'll be asked if the checklist is good (`y/n/edit`):
     - `y` (yes): Approves the checklist.
     - `n` (no): Asks if you want to regenerate. If yes, it retries (up to a limit). If no, the script exits.
     - `edit`: Saves the current checklist to `searches/checklist.md`. You can then open this file in a text editor, make your changes (one item per line), save it, and press Enter in the terminal to reload the checklist and re-approve.

5. **Automated Searching:** Once the checklist is approved, the script:

   - Performs a text search using the Pollinations API for each item.
   - Saves each result to a `.txt` file in the `results` folder (e.g., `1_search-term.txt`, `2_another-term.txt`).
   - Includes short delays between searches.

6. **Prepare Sources (Optional):** After the searches are complete, the script pauses:

   - You may review or edit the `.txt` files in the `results` folder.
   - You may add supplementary `.txt` or `.md` files to the `sources` folder.
   - Enter `y` to proceed to report generation, or `n` to cancel.

7. **Generate Final Report:**

   - The script reads all `.txt` files from the `results` folder and all `.txt`/`.md` files from the `sources` folder.
   - It sends the content to the selected Gemini report model.
   - The generated report is returned.

8. **Save Final Report:** The final report is saved as a Markdown file (e.g., `final_report_your-topic-slug.md`) in the root research folder.

9. **Completion:** A message is displayed confirming completion.

## Folder Structure

When the script runs for a specific topic (e.g., "Quantum Computing Trends"), it creates a main folder named after a slugified version of the topic (e.g., `quantum-computing-trends`). Inside this main folder, the following structure is generated:

```
<your-topic-slug>/
├── searches/
│   └── checklist.md       # The approved (or edited) research checklist
├── results/
│   ├── 1_item-one.txt     # Text result from Pollinations search for checklist item 1
│   ├── 2_item-two.txt     # Text result for item 2
│   └── ...                # More result files
├── sources/
│   └── (empty by default) # Place your supplementary .txt or .md files here
└── final_report_<your-topic-slug>.md # The final generated report
```

## API Keys

- **Google Gemini API Key:** This is **required**. The script uses this key to interact with the Gemini models for checklist and report generation. It must be placed in the `.env` file as `GEMINI_API_KEY=YOUR_KEY`.
- **Pollinations API:** The script uses the public `text.pollinations.ai` endpoint for text searches. **No API key is required** for this service.

## AI Models Used

The script uses the following AI models via API calls:

- **Checklist Generation:** Google Gemini

  - Default: `gemini-2.0-flash`
  - Recommended for fast, structured checklists

- **Report Generation:** Google Gemini

  - Default: `gemini-2.5-pro-exp-03-25`
  - Recommended for thorough and detailed report output

- **Text Search:** Pollinations Search (`text.pollinations.ai`)

  - Uses `?model=searchgpt` for high-quality web search results

## Error Handling

The script incorporates robust error-handling mechanisms:

- **API Call Retries:**

  - The `executeCurlWithRetry` function retries failed cURL commands up to `MAX_RETRIES` times with a `RETRY_DELAY_MS` between attempts.

- **Gemini API Specific Errors:**

  - Detects and logs blocked content (e.g., `promptFeedback.blockReason`).
  - Distinguishes between 4xx (client) and 5xx (server) errors.
  - Halts on unrecoverable errors (e.g., rate limits, invalid JSON, missing text).

- **cURL Errors:**

  - Captures and logs standard error output from cURL.

- **File System Errors:**

  - Wrapped in `try...catch` to handle `ENOENT`, permission issues, etc.

- **Checklist Generation Failures:**

  - If the checklist fails to generate or parse, retries are available.

- **Missing Inputs:**

  - Warns if there are no search results or source files before generating the report.

- **Global Error Catching:**

  - The main function is wrapped in `try...catch` with full stack trace logging.

- **Resource Cleanup:**

  - Ensures that the readline interface is closed even on failure using `finally`.

