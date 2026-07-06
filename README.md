# Seminar Q&A

A real-time, AI-graded Q&A web app for seminars and workshops. A presenter broadcasts questions to teams of participants, who submit answers that are automatically scored and given feedback by a local LLM (via [Ollama](https://ollama.com)), all synced live over WebSockets.

## How it works

- **Presenter** picks or writes a question and broadcasts it to everyone connected.
- **Participants** join under a team name and submit answers to the live question.
- Each answer is queued and sent to a local **Ollama** model (`mistral`) along with grading context, which returns a **score out of 10** and brief feedback.
- Results are broadcast back to the team and to the presenter in real time.
- At the end of the session, the presenter can trigger **final results**, ranking teams by average score, with a dedicated **winner announcement** screen.

## Pages

| Page | Purpose |
|---|---|
| `public/index.html` | Landing page — participants enter a team name to join |
| `public/participant.html` | Participant view — see the current question, submit answers, see live scores |
| `public/presenter.html` | Presenter view — push questions, monitor incoming answers, trigger results |
| `public/presentant.html` | Additional presenter-side view |
| `public/winner.html` | Final leaderboard / winner announcement screen |

## Tech stack

- **Backend:** Node.js, [Express](https://expressjs.com/) (static file serving), [ws](https://github.com/websockets/ws) (WebSocket server)
- **AI grading:** [Ollama](https://ollama.com) running the `mistral` model locally
- **Frontend:** Plain HTML/CSS/JavaScript (no build step)

## Prerequisites

- [Node.js](https://nodejs.org/) (v16+ recommended)
- [Ollama](https://ollama.com) installed and running locally, with the `mistral` model pulled:
  ```bash
  ollama pull mistral
  ```

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Dexterisham/AI_QnA.git
   cd AI_QnA
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Make sure Ollama is running locally on the default port (`http://localhost:11434`).
4. Start the server:
   ```bash
   npm start
   ```
5. Open the app in your browser at `http://localhost:3000`.
   - Share this link with participants so they can join and enter a team name.
   - Open `presenter.html` on the presenter's machine/screen to control the session.

## Grading context

Answer evaluation is guided by `context.md`, which contains case-study scenarios (e.g. Singleton and Prototype design patterns) used as grading context for the AI model. You can edit this file to change the topics and scenarios the app evaluates answers against.

## Project structure

```
AI_QnA/
├── public/
│   ├── index.html          # Join page
│   ├── participant.html    # Participant view
│   ├── presenter.html      # Presenter view
│   ├── presentant.html     # Presenter-side view
│   └── winner.html         # Winner/results screen
├── server.js                # Express + WebSocket server, Ollama integration
├── context.md               # Grading context/scenarios for the AI evaluator
├── package.json
└── package-lock.json
```

## Notes

- Question/answer state (current question, session history, team answers) is kept in memory on the server and resets when the server restarts.
- The evaluation pipeline processes answers one at a time via a queue, notifying each team of their position while they wait.
