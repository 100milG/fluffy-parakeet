# AI Realty Chatbot — Run & Test Guide

This guide contains step-by-step instructions and commands to run, monitor, and test your chatbot server from the terminal.

---

## 🚀 1. Starting the Server

Make sure your dependencies are installed, database is connected, and your `.env` contains a valid `GEMINI_API_KEY` (starting with `AIzaSy`).

Run the following command in your terminal to start the development server:
```powershell
npm run dev
```

The server will compile and start listening on port `3001`. You should see this message:
```
🚀 AI Chatbot server running on http://localhost:3001
Available endpoints:
  GET  http://localhost:3001/api/health
  POST http://localhost:3001/api/chat
  GET  http://localhost:3001/api/chat/:sessionId
```

### 🖥️ 1.2 Viewing the Database (Prisma Studio)
If you want to view, search, and edit database rows (like the 6,000+ imported properties) in a visual spreadsheet-like browser interface, run:
```powershell
npx prisma studio --port 5500
```
Then open your browser and navigate to:
👉 **[http://localhost:5500](http://localhost:5500)**

*(Note: Prisma Studio is a developer tool and does not need to be running for the chatbot server to work).*

---


## 🔍 2. Health & Status Checks

You can query the health endpoint to see active sessions and your Gemini API usage stats.

### Using PowerShell:
```powershell
$r = Invoke-RestMethod -Uri "http://localhost:3001/api/health"
$r | ConvertTo-Json -Depth 5
```

### Using Curl:
```bash
curl http://localhost:3001/api/health
```

---

## 💬 3. Interactive Terminal Testing Flows

Copy and paste these commands directly into your PowerShell terminal to simulate user chats.

### Flow A: Immediate Multi-Filter Search (One-Shot)
Use this command to send a query containing all preferences in a single turn. Reeva should return matching property listings immediately.

```powershell
$body = '{"message": "I need a 2 BHK flat in Bandra under 3 crores"}'
$r = Invoke-RestMethod -Uri "http://localhost:3001/api/chat" -Method Post -ContentType "application/json" -Body $body
$r.reply
```

---

### Flow B: Preference Accumulation & Follow-Ups (Multi-Turn)
Use this sequence to test how Reeva remembers your details across turns and prompts you for missing parameters.

**Turn 1: State location only**
```powershell
$body1 = '{"message": "I want a flat in Andheri"}'
$r1 = Invoke-RestMethod -Uri "http://localhost:3001/api/chat" -Method Post -ContentType "application/json" -Body $body1
$sid = $r1.sessionId
Write-Host "Turn 1 Response: $($r1.reply)"
```

**Turn 2: Provide the BHK and budget**
```powershell
$body2 = "{`"sessionId`": `"$sid`", `"message`": `"2 BHK, under 80 lakhs`"}"
$r2 = Invoke-RestMethod -Uri "http://localhost:3001/api/chat" -Method Post -ContentType "application/json" -Body $body2
Write-Host "Turn 2 Response: $($r2.reply)"
```

**Turn 3: Request recommendation listings**
```powershell
$body3 = "{`"sessionId`": `"$sid`", `"message`": `"yes show me the listings`"}"
$r3 = Invoke-RestMethod -Uri "http://localhost:3001/api/chat" -Method Post -ContentType "application/json" -Body $body3
Write-Host "Turn 3 Response: $($r3.reply)"
```

**Turn 4: Explain listing recommendation**
```powershell
$body4 = "{`"sessionId`": `"$sid`", `"message`": `"why is listing 1 recommended?`"}"
$r4 = Invoke-RestMethod -Uri "http://localhost:3001/api/chat" -Method Post -ContentType "application/json" -Body $body4
Write-Host "Turn 4 Response: $($r4.reply)"
```

---

## 🎨 4. Testing with the Visual Client

1. Navigate to the chatbot project directory on your machine.
2. Locate the file **`test-client.html`**.
3. Double-click it (or drag and drop it into a browser tab).
4. Type and chat with Reeva. The page will show your active session properties and highlight extracted values on the right-hand panel live!

---

## 🛠️ 5. Troubleshooting Common Issues

### 1. Port 3001 is already in use
If the server crashes on start stating the port is already bound:
- **Find and kill the process using port 3001 (PowerShell):**
  ```powershell
  Get-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess | Stop-Process -Force
  ```

### 2. Gemini API Quota / 429 Errors
If the chatbot replies with *"I apologize, I'm having a brief technical issue..."* and the console logs `429 Too Many Requests`:
- Wait **45 seconds** without sending any messages.
- Do not run automated scripts that query the API multiple times a second; space your requests out naturally like a human chatter.

### 3. Invalid API Key
If the console logs `API key not valid`:
- Open your `.env` file and make sure `GEMINI_API_KEY` starts with `AIzaSy`.
- Restart the server so it reads the new value.
