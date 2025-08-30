
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 8002;
const imagesDir = path.join(process.env.HOME, 'debug_images');

// Ensure the images directory exists
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}

// Serve static files for the frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve the actual image files
app.use('/images', express.static(imagesDir));

// API endpoint to get the list of images with pagination
app.get('/api/images', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;

    fs.readdir(imagesDir, (err, files) => {
        if (err) {
            console.error('Error reading images directory:', err);
            return res.status(500).json({ error: 'Could not read images directory' });
        }
        // Sort files by modification time, newest first
        const sortedFiles = files
            .map(file => ({
                name: file,
                time: fs.statSync(path.join(imagesDir, file)).mtime.getTime(),
            }))
            .sort((a, b) => b.time - a.time)
            .map(file => file.name);
        
        const startIndex = (page - 1) * pageSize;
        const endIndex = page * pageSize;
        const paginatedFiles = sortedFiles.slice(startIndex, endIndex);
        
        res.json({
            images: paginatedFiles,
            totalPages: Math.ceil(sortedFiles.length / pageSize),
            currentPage: page
        });
    });
});

// WebSocket connection handler
wss.on('connection', ws => {
    console.log('Client connected to WebSocket');
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Function to broadcast a message to all connected WebSocket clients
function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Watch for new files in the images directory
const watcher = chokidar.watch(imagesDir, {
    ignored: /initial\.|\.tmp$/,
    persistent: true,
    ignoreInitial: true, // Don't send notifications for existing files on startup
});

console.log(`Watching for new images in: ${imagesDir}`);

watcher.on('add', filePath => {
    const fileName = path.basename(filePath);
    console.log(`New image detected: ${fileName}`);
    // Notify clients about the new image
    broadcast({ type: 'new_image', file: fileName });
});

server.listen(PORT, () => {
    console.log(`Image viewer server running on http://localhost:${PORT}`);
});
