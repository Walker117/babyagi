import { OpenAI } from "openai"
import { ChromaClient, OpenAIEmbeddingFunction, Collection } from "chromadb"
import prompt from "prompt-sync"
import assert from "assert"
import * as dotenv from "dotenv"
import Groq from 'groq-sdk';
import { randomUUID } from "crypto"
dotenv.config()

export enum AIModel {
    GPT3T = 'gpt-3.5-turbo',
    GPT4T = 'gpt-4-turbo',
    Mixtral = 'mixtral-8x7b-32768',
    Llama3Small = 'llama3-8b-8192',
    Llama3Large = 'llama3-70b-8192'
}
interface Task {
    taskId: string
    taskName: string
}

export enum LLM_API {
    OpenAI = "OpenAI",
    Groq = "Groq"
}

const api: LLM_API = LLM_API.OpenAI as LLM_API
const model: AIModel = ((api: LLM_API): AIModel => {
    switch (api) {
        case LLM_API.OpenAI:
            return AIModel.GPT3T
        case LLM_API.Groq:
            return AIModel.Llama3Large
    }
})(api)

const TABLE_NAME = "babyagi_context"

// Run config
const BABY_NAME = "BabyAGI"

// Goal config
const p = prompt()
const OBJECTIVE = p("What is BabyAGI's objective? ")
const INITIAL_TASK = "Break down the objective into simple steps that you need to provide the answer" // p("What is the initial task to complete the objective? ") 
assert(OBJECTIVE, "No objective provided.")
assert(INITIAL_TASK, "No initial task provided.")

console.log('\x1b[95m\x1b[1m\n*****CONFIGURATION*****\n\x1b[0m\x1b[0m')
console.log(`Name: ${BABY_NAME}`)
console.log(`API: ${api}`)
console.log(`Model: ${model}`)

console.log("\x1b[94m\x1b[1m" + "\n*****OBJECTIVE*****\n" + "\x1b[0m\x1b[0m")
console.log(`${OBJECTIVE}`)

console.log(`\x1b[93m\x1b[1m \nInitial task: \x1b[0m\x1b[0m ${INITIAL_TASK}`)

// Define OpenAI embedding function using Chroma 
const embeddingFunction = new OpenAIEmbeddingFunction({ openai_api_key: process.env.OPENAI_API_KEY ?? "" })

// Configure OpenAI
const llm = (() => {
    switch (api) {
        case LLM_API.OpenAI:
            return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        case LLM_API.Groq:
            return new Groq({ apiKey: process.env.GROQ_API_KEY })
    }
})()

//Task List
var taskList: Task[] = []

// Connect to chromadb and create/get collection
const chromaConnect = async (): Promise<Collection> => {
    const chroma = new ChromaClient({ path: "http://localhost:8000" })
    const metric = "cosine"
    const collections = await chroma.listCollections()
    const collectionNames = collections.map((c) => c.name)

    if (collectionNames.includes(TABLE_NAME)) {
        // reset collection
        console.log("Erasing vector database...")
        await chroma.deleteCollection({ name: TABLE_NAME })
    }

    const collection = await chroma.getOrCreateCollection(
        {
            name: TABLE_NAME,
            metadata: {
                "hnsw:space": metric
            },
            embeddingFunction
        }
    )
    return collection
}

const add_task = (task: Task) => { taskList.push(task) }

const clear_tasks = () => { taskList = [] }

const sessionId = randomUUID().toString()
let currentTaskId = 0
const generateNewTaskId = (): string => {
    currentTaskId++
    return `${sessionId}_${currentTaskId}`
}

const openai_completion = async (prompt: string, temperature = 0.5, maxTokens = 100): Promise<string> => {
    const messages = [{ role: "system" as "system", content: prompt, name: BABY_NAME }]
    const params = {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature,
        n: 1,
        stop: null
    }

    switch (api) {
        case LLM_API.OpenAI:
            const openAI_response = await (llm as OpenAI).chat.completions.create(params)
            return openAI_response.choices[0].message.content ?? ""
        case LLM_API.Groq:
            const response = await (llm as Groq).chat.completions.create(params)
            return response.choices[0].message.content ?? ""
    }
}

const task_creation_agent = async (objective: string, result: string, task_description: string, taskList: Task[]): Promise<{ taskName: string }[]> => {
    const prompt = `
        You are an task creation AI that uses the result of an execution agent to create new tasks with the following objective: ${objective}, 
        The last completed task has the result: ${result}. 
        This result was based on this task description: ${task_description}. 
        These are incomplete tasks: ${taskList.map(task => `${task.taskId}: ${task.taskName}`).join(', ')}. 
        Based on the result, create new tasks to be completed by the AI system that do not overlap with incomplete tasks. 
        Return the tasks as an array.`
    const response = await openai_completion(prompt)
    const newTasks = response.trim().includes("\n") ? response.trim().split("\n") : [response.trim()];
    return newTasks.map(taskName => ({ taskName: taskName }));
}

const prioritization_agent = async () => {
    const taskNames = taskList.map((task) => task.taskName)
    const prompt = `
    You are an task prioritization AI tasked with cleaning the formatting of and reprioritizing the following tasks: ${taskNames}. 
    Consider the ultimate objective of your team:${OBJECTIVE}. Do not remove any tasks. Return the result as a numbered list.`
    const response = await openai_completion(prompt)
    const newTasks = response.trim().includes("\n") ? response.trim().split("\n") : [response.trim()];
    clear_tasks()
    newTasks.forEach((newTask) => {
        const newTaskParts = newTask.trim().split(/\.(?=\s)/)
        if (newTaskParts.length == 2) {
            const newTaskId = generateNewTaskId()
            const newTaskName = newTaskParts[1].trim()
            add_task({
                taskId: newTaskId,
                taskName: newTaskName
            })
        }
    })
}

const execution_agent = async (objective: string, task: string, chromaCollection: Collection) => {
    const context = await context_agent(objective, 5, chromaCollection)
    const prompt = `
    You are an AI who performs one task based on the following objective: ${objective}.\n
    Take into account these previously completed tasks: ${context}.\n
    Your task: ${task}\nResponse:`
    const response = await openai_completion(prompt, undefined, 2000)
    return response
}

const context_agent = async (query: string, topResultsNum: number, chromaCollection: Collection) => {
    const count = await chromaCollection.count()
    if (count == 0) {
        return []
    }

    const vector = (await embeddingFunction.generate([query])).shift()
    const data = {
        queryEmbeddings: vector,
        nResults: topResultsNum,
    }
    const results = await chromaCollection.query(data)
    return results.documents.map(document => document ?? "")
}

const responderAgent = async (query: string, topResultsNum: number, chromaCollection: Collection) => {
    const context = await context_agent(query, topResultsNum, chromaCollection)
    const prompt = `
    You are an AI who responds to a query based on the following context: ${context}.\n
    Your query: ${query}\nResponse:`
    const response = await openai_completion(prompt, undefined, 2000)
    return response
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

(async () => {
    const initialTask = {
        taskId: generateNewTaskId(),
        taskName: INITIAL_TASK
    }
    add_task(initialTask)
    const chromaCollection = await chromaConnect()

    while (true) {
        console.log("\x1b[95m\x1b[1m" + "\n*****TASK LIST*****\n" + "\x1b[0m\x1b[0m")
        taskList.forEach(t => {
            console.log(" • " + t.taskName)
        })

        // Step 1: Pull the first task
        const task = taskList.shift()
        if (!task) {
            break
        }
        console.log("\x1b[92m\x1b[1m" + "\n*****NEXT TASK*****\n" + "\x1b[0m\x1b[0m")
        console.log(task.taskId + ": " + task.taskName)

        // Send to execution function to complete the task based on the context
        const result = await execution_agent(OBJECTIVE, task.taskName, chromaCollection)
        console.log("\x1b[93m\x1b[1m" + "\nTASK RESULT\n" + "\x1b[0m\x1b[0m")
        console.log(result)

        // Step 2: Enrich result and store in Chroma
        const resultId = `result_${task.taskId}`
        const metadata = { taskId: task.taskId, task: task.taskName }
        const embedding = (await embeddingFunction.generate([result])).shift()

        await chromaCollection.add({
            ids: resultId,
            embeddings: embedding,
            metadatas: metadata,
            documents: result
        })

        // Step 3: Create new tasks and reprioritize task list
        const newTasks = await task_creation_agent(OBJECTIVE, result, task.taskName, taskList)
        newTasks.forEach((task) => {
            const newTask = {
                taskId: generateNewTaskId(),
                taskName: task.taskName
            }
            add_task(newTask)
        })
        await prioritization_agent()
        await sleep(30)
    }
}
)()

