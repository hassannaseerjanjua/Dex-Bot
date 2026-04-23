import sounddevice as sd
import numpy as np
from openwakeword.model import Model
import websocket
import json
import time

# Initialize openWakeWord model
# Default models include "alexa", "hey_mycroft", "hey_jarvis", "hey_rhasspy"
model = Model(inference_framework="onnx")

# Connect to Electron (WebSocket) with retry logic
ws = None
def connect_ws():
    global ws
    while True:
        try:
            ws = websocket.create_connection("ws://localhost:3000")
            print("✅ Connected to Electron WebSocket")
            break
        except Exception as e:
            print(f"Waiting for Electron server... (make sure the app is running)")
            time.sleep(2)

connect_ws()

last_detection_time = 0
DETECTION_DEBOUNCE = 3.0 # seconds

def callback(indata, frames, time_info, status):
    global last_detection_time
    if status:
        print(f"Error: {status}")
    
    # openWakeWord expects 1280 samples at 16kHz
    # indata is (1280, 1), we need to flatten it to 1D
    audio_data = indata.flatten()
    
    prediction = model.predict(audio_data)

    # Check for detections
    for key, score in prediction.items():
        if score > 0.6: # Increased score threshold slightly
            current_time = time.time()
            if current_time - last_detection_time > DETECTION_DEBOUNCE:
                print(f"🔥 Wake word detected: {key} (Score: {score:.2f})")
                try:
                    ws.send(json.dumps({"event": "wake_word"}))
                    last_detection_time = current_time
                except Exception as e:
                    print(f"Failed to send event: {e}")
                    connect_ws()

# Parameters for openWakeWord
# - 16,000 Hz sample rate
# - 1280 samples (~80ms) per block
CHUNK_SIZE = 1280

print("\n--- Wake Word Service Started ---")
print("Listening for 'Alexa', 'Hey Jarvis', 'Hey Mycroft', etc.")

try:
    with sd.InputStream(
        samplerate=16000,
        channels=1,
        dtype="int16",
        blocksize=CHUNK_SIZE,
        callback=callback
    ):
        print("Ready! Say a wake word...")
        while True:
            time.sleep(0.1)
except KeyboardInterrupt:
    print("\nStopping...")
except Exception as e:
    print(f"Error: {e}")