document.addEventListener('DOMContentLoaded', () => {
    const imageGrid = document.getElementById('image-grid');
    const loader = document.getElementById('loader');
    
    // --- State Management ---
    let isLoading = false;
    let currentPage = 1;
    let totalPages = 1;
    const DOM_IMAGE_LIMIT = 200; // Max images to keep in the browser display

    // --- DOM Functions ---
    const addImageToGrid = (file, prepend = false) => {
        const item = document.createElement('div');
        item.className = 'grid-item';

        const img = document.createElement('img');
        img.src = `/images/${file}`;
        img.alt = file;

        const filename = document.createElement('div');
        filename.className = 'filename';
        filename.textContent = file;

        item.appendChild(img);
        item.appendChild(filename);

        if (prepend) {
            imageGrid.insertBefore(item, imageGrid.firstChild);
        } else {
            imageGrid.appendChild(item);
        }
    };

    const pruneDOM = () => {
        while (imageGrid.children.length > DOM_IMAGE_LIMIT) {
            imageGrid.removeChild(imageGrid.lastChild);
        }
    };

    // --- API Functions ---
    const loadImages = async () => {
        if (isLoading || currentPage > totalPages) return;
        
        isLoading = true;
        loader.style.display = 'block';

        try {
            const response = await fetch(`/api/images?page=${currentPage}`);
            const data = await response.json();

            if (data.images && data.images.length > 0) {
                data.images.forEach(file => addImageToGrid(file));
                totalPages = data.totalPages;
                currentPage++;
            }
        } catch (error) {
            console.error('Error fetching images:', error);
        }

        isLoading = false;
        loader.style.display = 'none';
    };

    // --- Event Listeners ---
    window.addEventListener('scroll', () => {
        // Load more when user is 500px from the bottom
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500 && !isLoading) {
            loadImages();
        }
    });

    // --- WebSocket Connection ---
    const setupWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}`);

        ws.onopen = () => {
            console.log('WebSocket connection established');
        };

        ws.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.type === 'new_image') {
                console.log('New image received:', message.file);
                addImageToGrid(message.file, true);
                pruneDOM(); // Prune DOM after adding a new image
            }
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed. Reconnecting in 5 seconds...');
            setTimeout(setupWebSocket, 5000);
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            ws.close();
        };
    };

    // --- Initial Load ---
    loadImages();
    setupWebSocket();
});