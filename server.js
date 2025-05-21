const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static('public'));

// Store connected clients and their roles
const clients = new Map();
let currentQuestion = "";
let answers = new Map();

// Store session history
const sessionHistory = {
    questions: [],
    teamAnswers: new Map(), // Map of teamName to array of answers
    currentQuestionIndex: -1
};

// Evaluation queue system
const evaluationQueue = {
    queue: [],
    isProcessing: false,
    
    addToQueue(answerData) {
        this.queue.push(answerData);
        console.log(`Added to evaluation queue. Queue length: ${this.queue.length}`);
        
        // Notify client about queue position
        const client = clients.get(answerData.clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'answerQueued',
                message: `Your answer has been queued. Position in queue: ${this.queue.length}`,
                queuePosition: this.queue.length
            }));
        }
        
        // Update queue positions for all waiting answers
        this.updateQueuePositions();
    },
    
    updateQueuePositions() {
        this.queue.forEach((item, index) => {
            const client = clients.get(item.clientId);
            if (client && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: 'queueUpdate',
                    queuePosition: index + 1,
                    totalInQueue: this.queue.length
                }));
            }
        });
    },
    
    async processQueue() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }
        
        this.isProcessing = true;
        const { clientId, question, answer, teamName } = this.queue[0];
        
        try {
            console.log(`Processing evaluation for team: ${teamName}`);
            
            // Notify client that evaluation is starting
            const client = clients.get(clientId);
            if (client && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: 'evaluationStarted',
                    message: 'Your answer is being evaluated...'
                }));
            }
            
            const evaluation = await evaluateAnswer(question, answer);
            
            // Store answer in current answers
            answers.set(clientId, {
                answer: answer,
                evaluation: evaluation,
                teamName: teamName
            });

            // Store answer in session history
            const teamAnswers = sessionHistory.teamAnswers.get(teamName);
            teamAnswers.push({
                question: question,
                answer: answer,
                evaluation: evaluation,
                questionIndex: sessionHistory.currentQuestionIndex
            });

            // Broadcast to all clients
            broadcastToAll({
                type: 'newAnswer',
                clientId,
                answer: answer,
                evaluation: evaluation,
                teamName
            });
            
            // Notify the specific team about their evaluation
            if (client && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: 'evaluationComplete',
                    evaluation: evaluation,
                    question: question
                }));
            }
            
            console.log(`Completed evaluation for team: ${teamName}`);
        } catch (error) {
            console.error(`Error evaluating answer for team ${teamName}:`, error);
            // Notify client of error
            const client = clients.get(clientId);
            if (client && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: 'evaluationError',
                    message: 'Error evaluating your answer. Please try again.'
                }));
            }
        }
        
        // Remove processed item and continue with next
        this.queue.shift();
        
        // Update remaining queue positions
        this.updateQueuePositions();
        
        // Process next item
        this.processQueue();
    }
};

// Read evaluation context
const evaluationContext = fs.readFileSync(path.join(__dirname, 'context.md'), 'utf8');

// Function to evaluate answer using Ollama
async function evaluateAnswer(question, answer) {
    try {
        console.log('\n=== Starting Answer Evaluation ===');
        console.log('Question:', question);
        console.log('Answer:', answer);

        const prompt = `
Using the following evaluation guidelines:

${evaluationContext}

Question: ${question}
Answer: ${answer}

Evaluate the answer according to the guidelines and provide a score out of 10.
Format your response exactly as:
Score: X/10
Explanation: [Your explanation]`;

        console.log('\nSending prompt to Ollama...');
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'mistral',
                prompt: prompt,
                stream: false
            })
        });

        const data = await response.json();
        console.log('\nReceived response from Ollama:');
        console.log('Raw response:', data.response);

        const evaluation = data.response.trim();
        
        // Parse the score and explanation
        const scoreMatch = evaluation.match(/Score:\s*(\d+)\/10/i);
        const explanationMatch = evaluation.match(/Explanation:\s*(.+)/i);
        
        const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
        const explanation = explanationMatch ? explanationMatch[1].trim() : 'No explanation provided';

        console.log('\nParsed Evaluation:');
        console.log('Score:', score);
        console.log('Explanation:', explanation);
        console.log('=== Evaluation Complete ===\n');

        return {
            score,
            explanation,
            fullEvaluation: evaluation
        };
    } catch (error) {
        console.error('\n=== Error in Evaluation ===');
        console.error('Error details:', error);
        console.error('=== Evaluation Failed ===\n');
        throw error;
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    const clientId = Date.now().toString();
    clients.set(clientId, { ws, role: null, teamName: null });

    // Send current question to new client
    ws.send(JSON.stringify({
        type: 'question',
        question: currentQuestion,
        questionIndex: sessionHistory.currentQuestionIndex
    }));

    // Send session history to new client
    if (sessionHistory.questions.length > 0) {
        ws.send(JSON.stringify({
            type: 'sessionHistory',
            history: {
                questions: sessionHistory.questions,
                teamAnswers: Array.from(sessionHistory.teamAnswers.entries())
            }
        }));
    }

    ws.on('message', async (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'join':
                clients.get(clientId).role = data.role;
                if (data.role === 'participant') {
                    clients.get(clientId).teamName = data.teamName;
                    // Initialize team answers array if not exists
                    if (!sessionHistory.teamAnswers.has(data.teamName)) {
                        sessionHistory.teamAnswers.set(data.teamName, []);
                    }
                    // Notify presenter about new participant
                    broadcastToPresenter({
                        type: 'join',
                        role: 'participant',
                        teamName: data.teamName
                    });
                } else if (data.role === 'presenter') {
                    // Send all current answers to presenter
                    ws.send(JSON.stringify({
                        type: 'allAnswers',
                        answers: Array.from(answers.entries())
                    }));
                }
                break;

            case 'answer':
                if (clients.get(clientId)?.role === 'participant') {
                    const client = clients.get(clientId);
                    if (!client || !client.teamName) {
                        console.error('Invalid client or missing team name:', clientId);
                        return;
                    }

                    // Add to evaluation queue
                    evaluationQueue.addToQueue({
                        clientId,
                        question: currentQuestion,
                        answer: data.answer,
                        teamName: client.teamName
                    });

                    // Start processing queue if not already processing
                    if (!evaluationQueue.isProcessing) {
                        evaluationQueue.processQueue();
                    }
                }
                break;

            case 'newQuestion':
                if (clients.get(clientId)?.role === 'presenter') {
                    // Store previous question in history if it exists
                    if (currentQuestion) {
                        sessionHistory.questions.push({
                            question: currentQuestion,
                            index: sessionHistory.questions.length
                        });
                    }
                    
                    currentQuestion = data.question;
                    sessionHistory.currentQuestionIndex = sessionHistory.questions.length;
                    answers.clear();
                    
                    // Broadcast to all clients
                    broadcastToAll({
                        type: 'question',
                        question: currentQuestion,
                        questionIndex: sessionHistory.currentQuestionIndex
                    });

                    // Log the broadcast
                    console.log('Broadcasting new question:', currentQuestion);
                }
                break;

            case 'selectQuestion':
                if (clients.get(clientId)?.role === 'presenter') {
                    const questionIndex = data.questionIndex;
                    if (questionIndex >= 0 && questionIndex < sessionHistory.questions.length) {
                        const selectedQuestion = sessionHistory.questions[questionIndex];
                        currentQuestion = selectedQuestion.question;
                        sessionHistory.currentQuestionIndex = questionIndex;
                        
                        // Broadcast to all clients
                        broadcastToAll({
                            type: 'question',
                            question: currentQuestion,
                            questionIndex: questionIndex
                        });

                        console.log('Broadcasting selected question:', currentQuestion);
                    }
                }
                break;
        }
    });

    ws.on('close', () => {
        const client = clients.get(clientId);
        if (client) {
            if (client.role === 'participant' && client.teamName) {
                broadcastToPresenter({
                    type: 'participantLeft',
                    clientId,
                    teamName: client.teamName
                });
            }
            clients.delete(clientId);
            answers.delete(clientId);
        }
    });
});

function broadcastToAll(message) {
    const messageStr = JSON.stringify(message);
    console.log('Broadcasting message:', message.type);
    clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(messageStr);
        }
    });
}

function broadcastToPresenter(message) {
    const messageStr = JSON.stringify(message);
    clients.forEach(client => {
        if (client.role === 'presenter' && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(messageStr);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
}); 