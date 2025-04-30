// --- START OF FILE index.js ---

// --- START OF FILE index.js ---

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import slugify from 'slugify';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
// Nenhuma biblioteca externa de busca de imagens é necessária agora

// --- Configuração Inicial ---
dotenv.config();
const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega apenas a chave do Gemini do .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const POLLINATIONS_API_URL_BASE = 'https://text.pollinations.ai/prompt/';
const SEARCH_MODEL_PARAM = '?model=searchgpt';

// Configurações de Retry
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// --- CONSTANTES DE MODELO E API ---
const DEFAULT_CHECKLIST_MODEL = 'gemini-2.0-flash'; // Note: This model might not exist or be named differently now. Common models are gemini-1.5-flash-latest, gemini-1.0-pro, gemini-1.5-pro-latest
const DEFAULT_REPORT_MODEL = 'gemini-2.5-pro-exp-03-25'; // Note: This model likely doesn't exist. Use gemini-1.5-pro-latest or similar.
const GEMINI_API_VERSION = 'v1beta';

// --- VALIDAÇÃO DAS CHAVES ESSENCIAIS ---
if (!GEMINI_API_KEY) {
    console.error('Erro Crítico: GEMINI_API_KEY não encontrada no .env');
    process.exit(1);
}
// Removida a validação das chaves GOOGLE

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// --- Funções Auxiliares (sem alterações significativas) ---

/** Monta URL Gemini */
function getGeminiApiUrl(modelName, apiKey) {
    const apiVersionPath = GEMINI_API_VERSION;
    return `https://generativelanguage.googleapis.com/${apiVersionPath}/models/${modelName}:generateContent?key=${apiKey}`;
}

/** Executa cURL com Retry */
async function executeCurlWithRetry(command, retries = MAX_RETRIES) {
    try {
        // Increased buffer size as reports can be large
        const { stdout, stderr } = await execPromise(command, { maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer
        if (stderr && !stdout?.trim()) {
             const isProgress = stderr.includes('%') && stderr.includes('bytes');
             // Log non-progress stderr as a warning, unless it clearly indicates an error
             if (!isProgress && (stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('fail'))) {
                 console.warn(`Curl stderr indicating potential error (attempt ${MAX_RETRIES - retries + 1}): ${stderr.substring(0, 200)}...`);
                 // Don't throw error yet, let API response parsing handle actual API errors
             } else if (!isProgress && stderr.trim()) {
                 // Log other non-progress stderr just for info
                 console.log(`Curl stderr info (attempt ${MAX_RETRIES - retries + 1}): ${stderr.substring(0, 150)}...`);
             }
        }
        // Gemini API Specific Error Handling
        if (command.includes('generativelanguage.googleapis.com')) {
            try {
                const parsedStdout = JSON.parse(stdout);
                // Check for explicit error object from the API
                if (parsedStdout.error) {
                    const { code = 'N/A', message = 'Unknown Error', status = 'N/A' } = parsedStdout.error;
                    console.warn(`API Gemini returned error: [${code} ${status}] ${message}`);
                    // Treat 4xx errors (except rate limit 429) as non-recoverable by retry
                    if (code === 429) {
                         throw new Error(`API Rate Limit Exceeded (429). Consider adding delays or increasing quota.`);
                    } else if (code >= 400 && code < 500) {
                         throw new Error(`API Client Error (${code}): ${message} (Non-recoverable)`);
                    }
                    // For other errors (like 5xx), throw to allow retry
                    throw new Error(`API Server Error (${code}): ${message}`);
                }
                // Check for content blocking via promptFeedback
                if (parsedStdout.promptFeedback?.blockReason) {
                    const reason = parsedStdout.promptFeedback.blockReason;
                    const safetyRatings = parsedStdout.promptFeedback.safetyRatings || [];
                    const ratingsDetails = safetyRatings.map(r => `${r.category}: ${r.probability}`).join(', ');
                    console.warn(`API Gemini blocked request. Reason: ${reason}. ${ratingsDetails ? 'Details: ' + ratingsDetails : ''}`);
                    // Blocking is usually non-recoverable with the same prompt
                    throw new Error(`API Gemini reported content blocking: ${reason} (Non-recoverable)`);
                }
                // Check if candidates array exists but is empty OR lacks the expected text part
                 if ((parsedStdout.candidates && parsedStdout.candidates.length === 0) ||
                     (parsedStdout.candidates && parsedStdout.candidates.length > 0 && !parsedStdout.candidates[0]?.content?.parts?.[0]?.text)) {
                    const finishReason = parsedStdout.candidates?.[0]?.finishReason;
                    const safetyInfo = JSON.stringify(parsedStdout.candidates?.[0]?.safetyRatings);
                    console.warn(`API Gemini returned no valid content in candidates. Finish Reason: ${finishReason || 'N/A'}. Safety: ${safetyInfo || 'N/A'}. Response: ${stdout.substring(0,300)}...`);
                    // If blocked by safety, it's non-recoverable
                    if (finishReason === 'SAFETY') {
                        throw new Error(`API Gemini returned no text due to safety filters. (Non-recoverable)`);
                    }
                    // Otherwise, it might be a temporary issue or model didn't generate text
                    throw new Error(`API Gemini returned response without valid text content.`);
                 }
            } catch (parseOrApiError) {
                // If the error is marked non-recoverable, re-throw it immediately
                if (parseOrApiError.message.includes('(Non-recoverable)') || parseOrApiError.message.includes('API Rate Limit Exceeded')) {
                    throw parseOrApiError;
                }
                 // If it's a JSON parsing error, the response was likely malformed
                 if (parseOrApiError instanceof SyntaxError) {
                    console.warn(`Failed to parse JSON response from API: ${parseOrApiError.message}. Response start: ${stdout.substring(0, 200)}...`);
                    // Malformed JSON is unlikely to be fixed by retry
                    throw new Error(`Failed to parse API JSON response. (Non-recoverable)`);
                 }
                 // Otherwise, it might be a recoverable API error caught above, let retry handle it
                throw parseOrApiError; // Throw other errors to trigger retry
            }
        }
        // If no errors thrown, return the stdout
        return stdout;
    } catch (error) {
        console.error(`Error executing command (Attempt ${MAX_RETRIES - retries + 1}): ${error.message}`);
        // Check if it's a non-recoverable error before deciding to retry
        if (error.message.includes('(Non-recoverable)') || error.message.includes('API Rate Limit Exceeded')) {
            console.error('Non-recoverable error detected. Stopping retries.');
            throw error; // Propagate the specific error up immediately
        }
        if (retries > 0) {
            console.log(`Retrying command in ${RETRY_DELAY_MS / 1000} seconds... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            return executeCurlWithRetry(command, retries - 1);
        } else {
            console.error('Maximum retry attempts exceeded for the command.');
            // Throw a final error indicating failure after retries
            throw new Error(`Final command execution failed after ${MAX_RETRIES} attempts. Last error: ${error.message}`);
        }
    }
}


/** Cria pasta */
async function createFolderIfNotExists(dirPath, verbose = false) {
    try {
        await fs.access(dirPath);
        if (verbose) console.log(`Pasta ${path.basename(dirPath)} já existe.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(dirPath, { recursive: true });
            if (verbose) console.log(`Pasta ${path.basename(dirPath)} criada com sucesso.`);
        } else {
            console.error(`Erro crítico ao verificar/criar pasta ${path.basename(dirPath)}:`, error);
            throw error; // Propagate critical errors
        }
    }
 }
/** Cria slug */
function createSlug(text) {
    return slugify(text, { lower: true, strict: true, remove: /[*+~.()'"!:@?\/\\%]/g });
 }
/** Pergunta Sim/Não/Editar */
async function askYesNoEdit(question) {
    while (true) {
        const answer = await rl.question(`${question} (s/n/editar): `);
        const lowerAnswer = answer.toLowerCase().trim();
        if (lowerAnswer === 's' || lowerAnswer === 'sim') return 'yes';
        if (lowerAnswer === 'n' || lowerAnswer === 'nao' || lowerAnswer === 'não') return 'no';
        if (lowerAnswer === 'editar' || lowerAnswer === 'e') return 'edit';
        console.log("Resposta inválida. Por favor, digite 's', 'n' ou 'editar'.");
    }
 }
/** Pergunta Sim/Não */
async function askYesNo(question) {
     while (true) {
         const answer = await rl.question(`${question} (s/n): `);
         const lowerAnswer = answer.toLowerCase().trim();
         if (lowerAnswer === 's' || lowerAnswer === 'sim') return true;
         if (lowerAnswer === 'n' || lowerAnswer === 'nao' || lowerAnswer === 'não') return false;
         console.log("Resposta inválida. Por favor, digite 's' ou 'n'.");
     }
 }

/** Gera Checklist */
async function generateChecklist(topic, apiKey) {
    const modelName = DEFAULT_CHECKLIST_MODEL; // Uses the potentially non-existent model name
    const geminiApiUrl = getGeminiApiUrl(modelName, apiKey);
    console.log(`\n🤖 Gerando checklist DETALHADA com ${modelName} (via cURL)...`);
    // Original Portuguese prompt
    const prompt = `Para uma pesquisa de nível empresarial sobre o tópico "${topic}", crie uma checklist EXTREMAMENTE detalhada e abrangente (cerca de 10-15 itens). Cada item deve ser uma pergunta específica ou um ponto de investigação que exija análise profunda. Exemplos de formato: "Analisar o market share dos principais concorrentes nos últimos 5 anos.", "Avaliar o impacto regulatório X na indústria Y.", "Quais são as tendências tecnológicas emergentes que afetam Z?". Formate a resposta APENAS como uma lista numerada simples (1., 2., 3., ...), sem introdução, conclusão ou texto adicional.`;
    const requestBody = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
    const escapedBody = requestBody.replace(/'/g, "'\\''"); // Basic escaping
    const curlCommand = `curl -s -X POST "${geminiApiUrl}" -H "Content-Type: application/json" -d '${escapedBody}'`;

    try {
        const stdout = await executeCurlWithRetry(curlCommand);
        const responseData = JSON.parse(stdout); // Assumes executeCurlWithRetry handled JSON errors
        const text = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
             // Relying on executeCurlWithRetry to have logged specific API errors/blocks
             console.error('Erro: Resposta da API Gemini (checklist) não continha o texto esperado ou foi bloqueada.');
             console.error('Resposta recebida (snippet):', JSON.stringify(responseData, null, 2).substring(0, 500));
             throw new Error('Não foi possível extrair o texto da checklist da resposta do Gemini.');
        }

        // Original parsing logic
        const checklistItems = text.split('\n')
            .map(line => line.trim().replace(/^\d+\.\s*/, '')) // Remove numbering
            .filter(item => item.length > 2); // Basic filter

        if (checklistItems.length === 0) {
            console.error('Erro: Gemini retornou texto para checklist, mas não foi possível extrair itens válidos.');
            console.error('Texto recebido:', text);
            throw new Error('Não foi possível gerar a checklist no formato esperado.');
        }
        console.log('✅ Checklist inicial gerada!');
        return checklistItems;
    } catch (error) {
        // Error already logged by executeCurlWithRetry
        console.error(`❌ Falha crítica ao gerar checklist com ${modelName}.`);
        throw error; // Re-throw to be handled by the main function's loop
    }
}

/** Revisa/Edita Checklist */
async function reviewAndEditChecklist(initialChecklist, checklistFilePath) {
    let currentChecklist = [...initialChecklist];
    while (true) {
        console.log("\n--- Checklist Proposta ---");
        currentChecklist.forEach((item, index) => console.log(`${index + 1}. ${item}`));
        console.log("------------------------");
        // Original Portuguese question
        const userChoice = await askYesNoEdit("❓ A checklist está boa para iniciar a pesquisa?");

        if (userChoice === 'yes') {
            await saveChecklistToFile(currentChecklist, checklistFilePath); // Save final approved list
            return currentChecklist; // Return the approved list
        } else if (userChoice === 'no') {
             // Original Portuguese question
            const regenerate = await askYesNo("❌ Você gostaria de tentar gerar a checklist novamente?");
            if (regenerate) return null; // Signal to the caller to retry generation
            else { console.log("Operação cancelada."); process.exit(0); } // Exit if user gives up
        } else if (userChoice === 'edit') {
            // Save the current list so the user has a file to edit
            await saveChecklistToFile(currentChecklist, checklistFilePath);
            console.log(`\n📝 Edite o arquivo: ${checklistFilePath}`); // Uses raw path, not clickable
            console.log("   Salve suas alterações e pressione Enter aqui quando terminar...");
            await rl.question("   Pressione Enter para continuar após a edição...");
            try {
                const editedContent = await fs.readFile(checklistFilePath, 'utf-8');
                // Simple parsing assuming one item per line after editing
                currentChecklist = editedContent.split('\n')
                                     .map(line => line.trim())
                                     .filter(line => line.length > 0); // Filter empty lines
                console.log("✅ Checklist atualizada a partir do arquivo.");
                // Loop continues to show the edited list and ask for approval again
            } catch (readError) {
                console.error(`❌ Erro ao ler o arquivo editado ${checklistFilePath}: ${readError.message}`);
                console.log("   Mantendo a checklist anterior. Pressione Enter para confirmar ou editar novamente.");
                await rl.question("   Pressione Enter..."); // Pause before looping
            }
        }
    }
}

/** Salva Checklist */
async function saveChecklistToFile(checklistItems, checklistFilePath) {
    // Original formatting
    const markdownContent = checklistItems.map((item, index) => `${index + 1}. ${item}`).join('\n');
    try {
         // Ensure directory exists first (important!)
         await createFolderIfNotExists(path.dirname(checklistFilePath));
        await fs.writeFile(checklistFilePath, markdownContent);
        console.log(`💾 Checklist salva em ${checklistFilePath}`); // Raw path
    } catch (error) {
        console.error(`Erro ao salvar a checklist em ${checklistFilePath}:`, error);
        // Original code didn't re-throw here, might mask issues in review loop
    }
}

/** Pesquisa com Pollinations */
async function searchWithPollinations(query, index) {
    const encodedQuery = encodeURIComponent(query);
    const url = `${POLLINATIONS_API_URL_BASE}${encodedQuery}${SEARCH_MODEL_PARAM}`;
    // Original short timeouts
    const curlCommand = `curl -s -L "${url}" --connect-timeout 20 --max-time 60`;
    console.log(`   [${index + 1}] 🔍 Pesquisando (Pollinations): "${query.substring(0, 50)}..."`);
    try {
        // Using the same retry logic as Gemini calls
        const resultText = await executeCurlWithRetry(curlCommand);

        // Basic checks from original code
        if (!resultText || resultText.trim().length === 0) {
            console.warn(`   [${index + 1}] ⚠️ Aviso (Pollinations): Resposta vazia.`);
            return `Aviso: Resposta vazia recebida da API Pollinations para esta pesquisa.`;
        }
        const lowerResult = resultText.toLowerCase();
        if (lowerResult.includes("error") || lowerResult.includes("not found") || resultText.includes("Internal Server Error") || resultText.includes("upstream request timeout")) {
           console.warn(`   [${index + 1}] ⚠️ Aviso (Pollinations): Possível erro retornado: ${resultText.substring(0,100)}...`);
           // Return the potential error message itself
           return `Erro retornado pela API Pollinations: ${resultText}`;
        }
        console.log(`   [${index + 1}] ✅ Pesquisa (Pollinations) concluída.`);
        return resultText.trim();
    } catch (error) {
        // executeCurlWithRetry already logs the error details and retry attempts
        console.error(`   [${index + 1}] ❌ Falha final ao pesquisar (Pollinations) "${query.substring(0, 50)}..."`);
        // Return a clear error message to be saved in the result file
        return `Erro crítico ao buscar resultado via cURL (Pollinations) após ${MAX_RETRIES} tentativas. Último erro: ${error.message}`;
    }
}


/** Salva Resultado */
async function saveSearchResult(query, result, index, resultsDirPath) {
    const safeFilename = `${index + 1}_${createSlug(query.substring(0, 50))}.txt`;
    const filePath = path.join(resultsDirPath, safeFilename);
    // Original content format
    const fileContent = `--- Pesquisa #${index + 1} ---\nItem: ${query}\n\n--- Resultado ---\n${result}`;
    try {
        // Ensure directory exists first
        await createFolderIfNotExists(path.dirname(filePath));
        await fs.writeFile(filePath, fileContent);
        // Original code didn't log success here, keep it that way
    } catch (error) {
        console.error(`   [${index + 1}] ❌ Erro ao salvar resultado em ${safeFilename}: ${error.message}`);
    }
}

// --- REMOVED: Função searchImages ---
// --- REMOVED: Função saveImageUrls ---

/** Lê Fontes */
async function readSourceFiles(sourcesDirPath) {
    let sourceMaterial = '';
    console.log(`\n Sourcing material...`); // Original log message
    try {
        const sourceFiles = await fs.readdir(sourcesDirPath);
        // Original filter
        const textFiles = sourceFiles.filter(file => file.endsWith('.txt') || file.endsWith('.md'));
        if (textFiles.length === 0) {
            // Original Portuguese log
            console.log("   ℹ️ Nenhuma fonte encontrada em " + path.basename(sourcesDirPath));
            return ''; // Return empty string if no files found
        }
        // Original Portuguese log
        console.log(`   🔍 Lendo ${textFiles.length} arquivo(s) da pasta 'sources'...`);
        for (const file of textFiles) {
            const filePath = path.join(sourcesDirPath, file);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                // Original formatting for combining sources
                sourceMaterial += `--- Fonte: ${file} ---\n\n${content}\n\n---\n\n`;
                 // Original Portuguese log
                console.log(`      - ${file} lido com sucesso.`);
            } catch (readError) {
                // Original Portuguese log
                console.warn(`      ⚠️ Não foi possível ler o arquivo fonte ${file}: ${readError.message}`);
                // Original error format
                sourceMaterial += `--- Erro ao ler fonte: ${file} ---\n\n`;
            }
        }
        console.log('✅ Material fonte lido.');
        return sourceMaterial;
    } catch (error) {
         // Original error handling for directory access
         if (error.code === 'ENOENT') {
              // Original Portuguese log
             console.log("   ℹ️ Pasta 'sources' não encontrada.");
             return ''; // Return empty if directory doesn't exist
         } else {
            console.error(`❌ Erro crítico ao acessar a pasta 'sources' (${sourcesDirPath}):`, error);
            // Original error string
            return "[[Erro ao ler diretório de fontes]]\n\n";
         }
    }
}


/**
 * Gera relatório final via Gemini/cURL. (Original Version)
 * @param {string} topic Tema.
 * @param {string} reportModelName Modelo Gemini escolhido para o relatório.
 * @param {string} apiKey Sua chave de API Gemini.
 * @param {string} resultsDirPath Pasta de resultados de texto.
 * @param {string} sourcesDirPath Pasta de fontes.
 * @returns {Promise<string|null>} Conteúdo do relatório ou null/error string.
 */
async function generateFinalReport(topic, reportModelName, apiKey, resultsDirPath, sourcesDirPath) {
    console.log('\n📚 Preparando para gerar o relatório final...');
    const geminiApiUrl = getGeminiApiUrl(reportModelName, apiKey); // Uses potentially non-existent model

    // 1. Ler resultados de texto
    let combinedResults = '';
    let filesRead = 0;
    let errorsReading = 0;
    try {
        const resultFiles = await fs.readdir(resultsDirPath);
        // Original filter logic
        const txtFiles = resultFiles.filter(file => file.endsWith('.txt') && !file.toLowerCase().includes('image'));
        if (txtFiles.length === 0) {
             // Original Portuguese log
            console.warn("   ⚠️ Nenhum arquivo de resultado de texto encontrado em 'results'.");
        } else {
              // Original Portuguese log
             console.log(`   📖 Lendo ${txtFiles.length} arquivo(s) de resultado de texto...`);
             const readFilePromises = txtFiles.map(async (file) => {
                 const filePath = path.join(resultsDirPath, file);
                 try {
                     const content = await fs.readFile(filePath, 'utf-8');
                     filesRead++;
                     // Original formatting for combining results
                     return content + "\n\n---\n\n";
                  }
                 catch (readError) {
                     // Original Portuguese log
                     console.warn(`   ⚠️ Não foi possível ler ${file}: ${readError.message}`);
                     errorsReading++;
                     // Original error string
                     return `[[Erro ao ler o arquivo de resultado: ${file}]]\n\n---\n\n`;
                 }
             });
             combinedResults = (await Promise.all(readFilePromises)).join('');
              // Original Portuguese log
             console.log(`   📊 ${filesRead} resultados de texto lidos, ${errorsReading} erros.`);
        }
    } catch (error) {
         // Original error handling for results directory
        if (error.code === 'ENOENT') {
            console.warn(`   ⚠️ Pasta de resultados '${path.basename(resultsDirPath)}' não encontrada.`);
            combinedResults = "[[Pasta de resultados não encontrada]]\n\n"; // Original error string
         }
        else {
            console.error(`❌ Erro crítico ao ler a pasta de resultados (${resultsDirPath}):`, error);
             // Original error string
            combinedResults = "[[Erro crítico ao acessar os resultados individuais]]\n\n";
        }
    }

    // 2. Ler fontes (calls the original readSourceFiles)
    const sourceMaterial = await readSourceFiles(sourcesDirPath);

    // --- REMOVED: Leitura de URLs de Imagens ---

    // 3. Combinar e criar prompt final (Original logic and prompt)
    if (combinedResults.trim() === '' && sourceMaterial.trim() === '') {
         // Original Portuguese error
        console.error("❌ Nenhum resultado de texto ou fonte encontrado/lido. Impossível gerar relatório.");
        return null; // Return null if no data
    }

    // Original Portuguese log
    console.log(`🤖 Gerando relatório final DETALHADO com ${reportModelName} (via cURL)...`);
    // **ORIGINAL PORTUGUESE PROMPT**
    const prompt = `**Tarefa Urgente: Criação de Relatório Empresarial Detalhado**

**Tópico Central:** ${topic}

**Contexto:** Você é um analista sênior encarregado de compilar um relatório abrangente e profundo sobre o tópico acima. Utilize os dados de pesquisa individuais fornecidos e as fontes/instruções adicionais (se houver) para construir sua análise.

**Instruções Rigorosas:**
1.  **Estrutura Profissional:** Organize o relatório com uma introdução clara (objetivo e escopo), seções bem definidas com títulos e subtítulos descritivos, e uma conclusão robusta com insights chave e possíveis próximos passos ou recomendações.
2.  **Profundidade Analítica:** Não se limite a listar fatos. Analise, interprete, compare e contraste as informações. Identifique tendências, desafios, oportunidades e implicações.
3.  **Linguagem Formal:** Use um tom profissional e objetivo. Evite jargões excessivos, mas seja preciso.
4.  **Detalhes Essenciais:** Seja EXTREMAMENTE detalhado em cada seção. Forneça dados específicos sempre que disponíveis nas fontes. Elabore os pontos levantados.
5.  **Integração das Fontes:** Considere explicitamente o "Material Fonte Adicional" (se fornecido abaixo) como diretrizes, contexto ou dados primários, integrando-os de forma coesa ao relatório.
6.  **Síntese Coerente:** Mesmo que os dados de pesquisa contenham erros ou sejam fragmentados, seu papel é sintetizá-los da melhor forma possível, focando nas informações úteis e apresentando um fluxo lógico. Ignore mensagens de erro literais nos dados brutos.
7.  **Formatação Clara:** Use markdown de forma eficaz (negrito, itálico, listas) para melhorar a legibilidade.
8.  **Foco no Tópico:** Mantenha todo o conteúdo estritamente focado no tópico "${topic}".

**Dados Brutos:**

**--- Resultados das Pesquisas Individuais (Texto) ---**
${combinedResults}
**--- Fim dos Resultados das Pesquisas Individuais ---**

${sourceMaterial ? `**--- Material Fonte Adicional Fornecido Pelo Usuário ---**\n${sourceMaterial}\n**--- Fim do Material Fonte Adicional ---**` : ''}

**Produto Final Esperado:** Um relatório completo e polido em formato Markdown, pronto para apresentação a stakeholders, começando DIRETAMENTE com o título do relatório e o conteúdo estruturado conforme as instruções.`;


    const requestBody = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Original generation config and safety settings
        generationConfig: { temperature: 0.5 },
        safetySettings: [
           { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
           { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
           { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
           { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
         ]
    });
    const escapedBody = requestBody.replace(/'/g, "'\\''"); // Basic escaping
    const curlCommand = `curl -s -X POST "${geminiApiUrl}" -H "Content-Type: application/json" -d '${escapedBody}'`;

    try {
        const stdout = await executeCurlWithRetry(curlCommand);
        const responseData = JSON.parse(stdout); // Assumes valid JSON after retry logic
        const reportText = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reportText) {
            // Original error logging pattern
            console.error(`Erro: Resposta inesperada ou vazia de ${reportModelName} ao gerar relatório final.`);
            console.error('Resposta recebida:', JSON.stringify(responseData, null, 2));
             if (responseData?.promptFeedback?.blockReason) {
                 const reason = responseData.promptFeedback.blockReason; console.error(`Relatório bloqueado pela API Gemini (${reportModelName}): ${reason}`);
                 // Original error report format
                 return `## Erro na Geração do Relatório (${reportModelName})\n\nBloqueado por: ${reason}`;
             }
             if (responseData.error) { // Should have been caught by executeCurlWithRetry, but original code checked here too
                 const {status, message} = responseData.error; console.error(`API Gemini (${reportModelName}) retornou erro: [${status}] ${message}`);
                 // Original error report format
                 return `## Erro na Geração do Relatório (${reportModelName})\n\nErro API: [${status}] ${message}`;
             }
            throw new Error(`Não foi possível extrair o texto do relatório da resposta de ${reportModelName}.`);
        }
        // Original Portuguese success log
        console.log('✅ Relatório final gerado com sucesso!');
        return reportText;
    } catch (error) {
        // Error logged by executeCurlWithRetry
        console.error(`❌ Falha crítica ao gerar o relatório final com ${reportModelName}.`);
        // Original error report format
        return `## Erro Crítico na Geração do Relatório (${reportModelName})\n\nErro: ${error.message}\n\nVerifique logs, conexão, chaves e status da API Gemini.`;
    }
}


/** Salva Relatório Final */
async function saveFinalReport(reportContent, reportFilePath) {
    try {
        // Ensure directory exists first
        await createFolderIfNotExists(path.dirname(reportFilePath));
        await fs.writeFile(reportFilePath, reportContent);
        // Original Portuguese log with raw path
        console.log(`\n🎉 Relatório final salvo em: ${reportFilePath}`);
    } catch (error) {
        // Original Portuguese error log
        console.error(`❌ Erro crítico ao salvar o relatório final em ${reportFilePath}:`, error);
        // Original code didn't log content snippet here
    }
}

// --- Função Principal (Execução) - Original Version ---
async function main() {
    // Original title and variable names
    console.log("--- Assistente Avançado de Pesquisa Empresarial (vCurl - Apenas Texto) ---");
    let topic = '';
    let baseResearchFolder = '';
    let searchesDir = '';
    let resultsDir = '';
    let sourcesDir = '';
    let checklistFile = '';
    // Removido: let imageUrlsFile = '';
    let finalReportFile = '';
    let reportModelName = DEFAULT_REPORT_MODEL; // Uses potentially non-existent model

    try {
        // 1. Obter Tema e Configurar Pastas (Original Portuguese prompts/logs)
        topic = await rl.question('❓ Qual o tema central da sua pesquisa? ');
        topic = topic.trim();
        if (!topic) { console.log('❌ Tema inválido. Saindo.'); return; }

        const safeFolderName = createSlug(topic);
        baseResearchFolder = path.join(__dirname, safeFolderName);
        searchesDir = path.join(baseResearchFolder, 'searches');
        resultsDir = path.join(baseResearchFolder, 'results');
        sourcesDir = path.join(baseResearchFolder, 'sources');
        checklistFile = path.join(searchesDir, 'checklist.md');
        // Removido: imageUrlsFile = path.join(...);
        finalReportFile = path.join(baseResearchFolder, `final_report_${safeFolderName}.md`);

        console.log(`\n📂 Organizando tudo na pasta: ${baseResearchFolder}`); // Raw path
        await createFolderIfNotExists(baseResearchFolder);
        await createFolderIfNotExists(searchesDir);
        await createFolderIfNotExists(resultsDir); // Pasta de resultados ainda é criada para os .txt
        await createFolderIfNotExists(sourcesDir, true); // Verbose for sources dir
         // Original Portuguese log
        console.log(`   -> Contexto (.txt, .md) em: '${path.basename(sourcesDir)}'.`);
        // Removido log sobre arquivo de imagens


        // 2. Escolher Modelo para Relatório Final (Original prompt/log)
        const modelChoice = await rl.question(`🤖 Modelo Gemini para relatório? (Enter=${DEFAULT_REPORT_MODEL}): `);
        if (modelChoice.trim()) { reportModelName = modelChoice.trim(); }
        console.log(`   Usando modelo '${reportModelName}' para o relatório.`);

        // 3. Gerar e Aprovar/Editar Checklist (Original flow)
        let checklist = null;
        let approvedChecklist = null;
        let attempt = 0;
        const maxChecklistAttempts = 2; // Original limit
        while (!approvedChecklist && attempt < maxChecklistAttempts) {
             attempt++;
             if (attempt > 1) console.log(`\n--- Tentativa ${attempt}/${maxChecklistAttempts} de gerar a Checklist ---`);
             try {
                // Calls original checklist functions
                checklist = await generateChecklist(topic, GEMINI_API_KEY);
                approvedChecklist = await reviewAndEditChecklist(checklist, checklistFile);
             } catch (checklistError) {
                  // Original Portuguese error logs
                 console.error(`❌ Falha ao gerar/processar checklist (Tentativa ${attempt}).`);
                 if (attempt < maxChecklistAttempts) {
                     const tryAgain = await askYesNo("Tentar gerar a checklist novamente?");
                     if (!tryAgain) { console.log("Saindo."); return; }
                 } else {
                     console.error("❌ Máximo de tentativas de gerar checklist atingido. Saindo."); return;
                 }
             }
        }
         // Original check and log
         if (!approvedChecklist || approvedChecklist.length === 0) {
             console.error("❌ Checklist final vazia ou não aprovada. Impossível continuar."); return;
         }
         console.log(`👍 Checklist final com ${approvedChecklist.length} itens aprovada.`);

        // 4. Executar Pesquisas Individuais de Texto (Pollinations) - Based on approved checklist
        // Original Portuguese log
        console.log('\n--- Iniciando Pesquisas de Texto Individuais (Pollinations via cURL) ---');
        const searchPromises = approvedChecklist.map((item, i) =>
            searchWithPollinations(item, i) // Calls original search function
                .then(searchResult => saveSearchResult(item, searchResult, i, resultsDir)) // Saves result
                .then(() => new Promise(resolve => setTimeout(resolve, 250))) // Original delay
                .catch(err => console.error(`Erro não capturado na pesquisa ${i+1}: ${err}`)) // Basic catch
        );
        await Promise.all(searchPromises); // Waits for all searches
         // Original Portuguese log
        console.log('--- Pesquisas de Texto Individuais Concluídas ---');

        // --- REMOVED: Executar Pesquisa de Imagens ---
        // --- REMOVED: Salvar URLs de Imagens ---

        // 5. Pausa para Revisão e Fontes (Original Portuguese logs)
        console.log(`\n👀 Resultados de texto salvos em: ${path.basename(resultsDir)}`);
        console.log(`   Edite os arquivos .txt se necessário.`);
        console.log(`   Adicione arquivos de fonte (.txt, .md) em: ${path.basename(sourcesDir)}`);
        const proceed = await askYesNo("❓ Pronto para gerar o relatório final consolidado?");
        if (!proceed) { console.log("Operação cancelada."); return; }

        // 6. Gerar Relatório Final (Calls original report function)
        const finalReportContent = await generateFinalReport(
            topic,
            reportModelName,
            GEMINI_API_KEY,
            resultsDir, // Uses results from step 4
            sourcesDir
        );

        // 7. Salvar Relatório Final (Calls original save function)
        if (finalReportContent) {
             await saveFinalReport(finalReportContent, finalReportFile);
        } else {
             // Original Portuguese error log
             console.error("❌ Relatório final não pôde ser gerado ou retornou vazio.");
        }

        // Original Portuguese completion message
        console.log('\n✨ Processo de pesquisa avançada concluído! ✨');

    } catch (error) {
        // Original Portuguese error log
        console.error('\n\n❌ Ocorreu um erro fatal inesperado no fluxo principal:', error.message);
        if (error.stack) { console.error("Stack Trace:", error.stack); }
    } finally {
        rl.close(); // Ensure readline is closed
    }
}

// Inicia a execução
main();

// --- END OF FILE index.js ---