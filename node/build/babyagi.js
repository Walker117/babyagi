"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const openai_1 = require("openai");
const chromadb_1 = require("chromadb");
const prompt_sync_1 = __importDefault(require("prompt-sync"));
const assert_1 = __importDefault(require("assert"));
const dotenv = __importStar(require("dotenv"));
dotenv.config();
// const client = new ChromaClient("http://localhost:8000")
// API Keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
(0, assert_1.default)(OPENAI_API_KEY, "OPENAI_API_KEY environment variable is missing from .env");
const OPENAI_API_MODEL = process.env.OPENAI_API_MODEL || "gpt-3.5-turbo";
// Table config
const TABLE_NAME = process.env.TABLE_NAME || "";
(0, assert_1.default)(TABLE_NAME, "TABLE_NAME environment variable is missing from .env");
// Run config
const BABY_NAME = process.env.BABY_NAME || "BabyAGI";
// Goal config
const p = (0, prompt_sync_1.default)();
const OBJECTIVE = p("What is BabyAGI's objective? ");
const INITIAL_TASK = p("What is the initial task to complete the objective? ");
(0, assert_1.default)(OBJECTIVE, "No objective provided.");
(0, assert_1.default)(INITIAL_TASK, "No initial task provided.");
console.log('\x1b[95m\x1b[1m\n*****CONFIGURATION*****\n\x1b[0m\x1b[0m');
console.log(`Name: ${BABY_NAME}`);
console.log(`LLM: ${OPENAI_API_MODEL}`);
if (OPENAI_API_MODEL.toLowerCase().includes("gpt-4")) {
    console.log("\x1b[91m\x1b[1m\n*****USING GPT-4. POTENTIALLY EXPENSIVE. MONITOR YOUR COSTS*****\x1b[0m\x1b[0m");
}
console.log("\x1b[94m\x1b[1m" + "\n*****OBJECTIVE*****\n" + "\x1b[0m\x1b[0m");
console.log(`${OBJECTIVE}`);
console.log(`\x1b[93m\x1b[1m \nInitial task: \x1b[0m\x1b[0m ${INITIAL_TASK}`);
// Define OpenAI embedding function using Chroma 
const embeddingFunction = new chromadb_1.OpenAIEmbeddingFunction({ openai_api_key: OPENAI_API_KEY });
// Configure OpenAI
const params = {
    apiKey: OPENAI_API_KEY,
    verbose: true
};
const openai = new openai_1.OpenAI(params);
//Task List
var taskList = [];
// Connect to chromadb and create/get collection
const chromaConnect = () => __awaiter(void 0, void 0, void 0, function* () {
    const chroma = new chromadb_1.ChromaClient({ path: "http://localhost:8000" });
    const metric = "cosine";
    const collections = yield chroma.listCollections();
    const collectionNames = collections.map((c) => c.name);
    if (collectionNames.includes(TABLE_NAME)) {
        const collection = yield chroma.getCollection({ name: TABLE_NAME, embeddingFunction });
        return collection;
    }
    else {
        const collection = yield chroma.getOrCreateCollection({
            name: TABLE_NAME,
            metadata: {
                "hnsw:space": metric
            },
            embeddingFunction
        });
        return collection;
    }
});
const add_task = (task) => { taskList.push(task); };
const clear_tasks = () => { taskList = []; };
const get_ada_embedding = (text) => __awaiter(void 0, void 0, void 0, function* () {
    text = text.replace("\n", " ");
    const embedding = yield embeddingFunction.generate([text]);
    return embedding;
});
const openai_completion = (prompt, temperature = 0.5, maxTokens = 100) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const messages = [{ role: "system", content: prompt, name: BABY_NAME }];
    const response = yield openai.chat.completions.create({
        model: OPENAI_API_MODEL,
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature,
        n: 1,
        stop: null
    });
    return (_a = response.choices[0].message.content) !== null && _a !== void 0 ? _a : "";
});
const task_creation_agent = (objective, result, task_description, taskList) => __awaiter(void 0, void 0, void 0, function* () {
    const prompt = `
        You are an task creation AI that uses the result of an execution agent to create new tasks with the following objective: ${objective}, 
        The last completed task has the result: ${result}. 
        This result was based on this task description: ${task_description}. 
        These are incomplete tasks: ${taskList.map(task => `${task.taskId}: ${task.taskName}`).join(', ')}. 
        Based on the result, create new tasks to be completed by the AI system that do not overlap with incomplete tasks. 
        Return the tasks as an array.`;
    const response = yield openai_completion(prompt);
    const newTasks = response.trim().includes("\n") ? response.trim().split("\n") : [response.trim()];
    return newTasks.map(taskName => ({ taskName: taskName }));
});
const prioritization_agent = (taskId) => __awaiter(void 0, void 0, void 0, function* () {
    const taskNames = taskList.map((task) => task.taskName);
    const nextTaskId = taskId + 1;
    const prompt = `
    You are an task prioritization AI tasked with cleaning the formatting of and reprioritizing the following tasks: ${taskNames}. 
    Consider the ultimate objective of your team:${OBJECTIVE}. Do not remove any tasks. Return the result as a numbered list, like:
    #. First task
    #. Second task
    Start the task list with number ${nextTaskId}.`;
    const response = yield openai_completion(prompt);
    const newTasks = response.trim().includes("\n") ? response.trim().split("\n") : [response.trim()];
    clear_tasks();
    newTasks.forEach((newTask) => {
        const newTaskParts = newTask.trim().split(/\.(?=\s)/);
        if (newTaskParts.length == 2) {
            const newTaskId = Number(newTaskParts[0].trim());
            const newTaskName = newTaskParts[1].trim();
            add_task({
                taskId: newTaskId,
                taskName: newTaskName
            });
        }
    });
});
const execution_agent = (objective, task, chromaCollection) => __awaiter(void 0, void 0, void 0, function* () {
    const context = context_agent(objective, 5, chromaCollection);
    const prompt = `
    You are an AI who performs one task based on the following objective: ${objective}.\n
    Take into account these previously completed tasks: ${context}.\n
    Your task: ${task}\nResponse:`;
    const response = yield openai_completion(prompt, undefined, 2000);
    return response;
});
const context_agent = (query, topResultsNum, chromaCollection) => __awaiter(void 0, void 0, void 0, function* () {
    const count = yield chromaCollection.count();
    if (count == 0) {
        return [];
    }
    const data = {
        query: query,
        nResults: topResultsNum
    };
    const results = yield chromaCollection.query(data);
    return results.metadatas[0].map(item => item ? item.task : null);
});
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
(() => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    const initialTask = {
        taskId: 1,
        taskName: INITIAL_TASK
    };
    add_task(initialTask);
    const chromaCollection = yield chromaConnect();
    var taskIdCounter = 1;
    while (true) {
        if (taskList.length > 0) {
            console.log("\x1b[95m\x1b[1m" + "\n*****TASK LIST*****\n" + "\x1b[0m\x1b[0m");
            taskList.forEach(t => {
                console.log(" • " + t.taskName);
            });
            // Step 1: Pull the first task
            const task = taskList.shift();
            if (!task) {
                break;
            }
            console.log("\x1b[92m\x1b[1m" + "\n*****NEXT TASK*****\n" + "\x1b[0m\x1b[0m");
            console.log(task.taskId + ": " + task.taskName);
            // Send to execution function to complete the task based on the context
            const result = yield execution_agent(OBJECTIVE, task.taskName, chromaCollection);
            const currTaskId = task.taskId;
            console.log("\x1b[93m\x1b[1m" + "\nTASK RESULT\n" + "\x1b[0m\x1b[0m");
            console.log(result);
            // Step 2: Enrich result and store in Chroma
            const enrichedResult = { data: result }; // this is where you should enrich the result if needed
            const resultId = `result_${task.taskId}`;
            const vector = enrichedResult.data; // extract the actual result from the dictionary
            const collectionLength = (_b = (yield chromaCollection.get({
                ids: [resultId]
            })).ids) === null || _b === void 0 ? void 0 : _b.length;
            if (collectionLength > 0) {
                yield chromaCollection.update({
                    ids: [resultId],
                    metadatas: [{ task: task.taskName, result: result }],
                    documents: [vector]
                });
            }
            else {
                yield chromaCollection.add({
                    ids: resultId,
                    embeddings: undefined,
                    metadatas: { task: task.taskName, result },
                    documents: vector
                });
            }
            // Step 3: Create new tasks and reprioritize task list
            const newTasks = yield task_creation_agent(OBJECTIVE, enrichedResult.data, task.taskName, taskList);
            newTasks.forEach((task) => {
                taskIdCounter += 1;
                const newTask = {
                    taskId: taskIdCounter,
                    taskName: task.taskName
                };
                add_task(newTask);
            });
            yield prioritization_agent(currTaskId);
            yield sleep(3000);
        }
    }
}))();
