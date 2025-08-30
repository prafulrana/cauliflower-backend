#!/usr/bin/env python3
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
import numpy as np
from PIL import Image
from io import BytesIO
import uvicorn
from ultralytics import YOLOWorld
import json
import time
import os
from datetime import datetime
import asyncio

print("Starting Unified YOLOWorld server with ACK-based batching...", flush=True)

app = FastAPI()

# --- Helper function for non-blocking image saving ---
def save_debug_image(image_data):
    """Synchronous function to save an image to disk."""
    try:
        debug_dir = os.path.join(os.path.expanduser("~"), "debug_images")
        if not os.path.exists(debug_dir):
            os.makedirs(debug_dir)
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        file_path = os.path.join(debug_dir, f"{timestamp}.jpg")
        with open(file_path, "wb") as f:
            f.write(image_data)
        print(f"Debug image saved to: {file_path}", flush=True)
    except Exception as e:
        print(f"Error saving debug image: {e}", flush=True)

# Check GPU availability
device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"Device: {device}", flush=True)

# Load YOLOWorld model
print("Loading YOLOWorld model...", flush=True)
model = YOLOWorld('yolov8x-worldv2.pt')
model.to(device)
print("Model loaded successfully", flush=True)

# Warm up the model
print("Warming up model...", flush=True)
dummy_img = np.zeros((640, 640, 3), dtype=np.uint8)
model.predict(dummy_img, conf=0.05, device=device, verbose=False)
print("Model warmed up", flush=True)

@app.get('/health')
async def health():
    return {'status': 'healthy', 'model': 'YOLOWorld-Unified', 'device': device}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connection opened", flush=True)
    
    # --- Per-session settings ---
    confidence_threshold = 0.05
    iou_threshold = 0.45
    max_detections = 100
    roi = None
    save_images = False # Default to not saving images
    
    frame_buffer = []
    loop = asyncio.get_running_loop()
    
    try:
        while websocket.client_state == WebSocketState.CONNECTED:
            data = await websocket.receive()
            
            if 'text' in data:
                message = json.loads(data['text'])
                
                if message.get('type') == 'batch_complete':
                    if frame_buffer:
                        images = [Image.open(BytesIO(img_data)).convert("RGB") for img_data in frame_buffer]
                        start_time = time.time()
                        results = model.predict(images, conf=confidence_threshold, iou=iou_threshold, max_det=max_detections, device=device, verbose=False, stream=False)
                        inference_time = time.time() - start_time
                        print(f"Inference complete in {inference_time:.3f}s for {len(images)} frames", flush=True)

                        for i, r in enumerate(results):
                            detections = []
                            if r.boxes is not None:
                                for box, conf, cls in zip(r.boxes.xyxy, r.boxes.conf, r.boxes.cls):
                                    detections.append({
                                        'confidence': float(conf),
                                        'box': box.tolist(),
                                        'class': model.names[int(cls)]
                                    })
                            await websocket.send_json([{'success': True, 'detections': detections, 'inference_time': inference_time / len(images)}])
                        
                        frame_buffer.clear()
                
                elif 'keywords' in message:
                    # Update settings from the client
                    model.set_classes(message['keywords'])
                    confidence_threshold = message.get('confidence', confidence_threshold)
                    iou_threshold = message.get('iou', iou_threshold)
                    max_detections = message.get('max_det', max_detections)
                    roi = message.get('roi', roi)
                    save_images = message.get('save_images', save_images) # Update save_images flag
                    
                    print(f"Settings updated: save_images={save_images}", flush=True)
                    await websocket.send_text(json.dumps({'status': 'Settings received'}))
            
            elif 'bytes' in data:
                frame_buffer.append(data['bytes'])
                # Check the per-session flag before saving
                if save_images:
                    loop.run_in_executor(None, save_debug_image, data['bytes'])

    except WebSocketDisconnect:
        print("Client disconnected", flush=True)
    except Exception as e:
        print(f"WebSocket Error: {str(e)}", flush=True)
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("Starting unified server on port 8001...", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=8001)