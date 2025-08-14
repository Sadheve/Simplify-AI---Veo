/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Type, GenerateContentResponse, GenerateVideosOperation } from '@google/genai';

// --- DOM ELEMENTS ---
const promptInput = document.querySelector('#prompt-input') as HTMLTextAreaElement;
const generateButton = document.querySelector('#generate-button') as HTMLButtonElement;
const refreshButton = document.querySelector('#refresh-button') as HTMLButtonElement;
const statusEl = document.querySelector('#status') as HTMLParagraphElement;
const examplePromptsList = document.querySelector('#example-prompts-list') as HTMLDivElement;

const fileInput = document.querySelector('#file-input') as HTMLInputElement;
const uploadButton = document.querySelector('#upload-button') as HTMLButtonElement;
const imagePreviewContainer = document.querySelector('#image-preview-container') as HTMLDivElement;
const imagePreview = document.querySelector('#image-preview') as HTMLImageElement;
const removeImageButton = document.querySelector('#remove-image-button') as HTMLButtonElement;

const imageModeRadio = document.querySelector('#image-mode') as HTMLInputElement;
const videoModeRadio = document.querySelector('#video-mode') as HTMLInputElement;

const outputPlaceholder = document.querySelector('#output-placeholder') as HTMLDivElement;
const imageOutput = document.querySelector('#image-output') as HTMLImageElement;
const videoPlayer = document.querySelector('#video-player') as HTMLVideoElement;
const downloadButton = document.querySelector('#download-button') as HTMLAnchorElement;

const queueStatusContainer = document.querySelector('#queue-status-container') as HTMLDivElement;
const queueCountdown = document.querySelector('#queue-countdown') as HTMLParagraphElement;

const historyPanel = document.querySelector('#history-panel') as HTMLElement;
const historyButton = document.querySelector('#history-button') as HTMLButtonElement;
const closeHistoryButton = document.querySelector('#close-history-button') as HTMLButtonElement;
const historyGrid = document.querySelector('#history-grid') as HTMLDivElement;

const termsModalOverlay = document.querySelector('#terms-modal-overlay') as HTMLDivElement;
const termsAgreeButton = document.querySelector('#terms-agree-button') as HTMLButtonElement;

const apiKeyModalOverlay = document.querySelector('#api-key-modal-overlay') as HTMLDivElement;
const apiKeyInput = document.querySelector('#api-key-input') as HTMLInputElement;
const saveApiKeyButton = document.querySelector('#save-api-key-button') as HTMLButtonElement;


// --- STATE ---
type HistoryItem = {
  id: string;
  type: 'image' | 'video';
  dataUrl: string;
  prompt: string;
}
let isGenerating = false;
let isVideoDailyLimitReached = false; // For the hard daily video limit
let countdownInterval: number | null = null;
let uploadedImage: { data: string; mimeType: string; } | null = null;
let history: HistoryItem[] = [];
let apiKey: string | null = null;

let examplePrompts = [
  'A cinematic shot of a an astronaut riding a horse on Mars',
  'A delicious-looking cheeseburger in the style of a claymation',
  'A high-fashion model wearing a dress made of liquid chrome',
  'A logo for a coffee shop called "The Starry Bean"',
  'A photorealistic image of a cat wearing a tiny wizard hat',
];

let isGeneratingNewPrompts = false;

// --- API ---
let ai: GoogleGenAI;
const API_KEY_STORAGE_KEY = 'gemini-api-key';

// --- ERROR HANDLING ---

/**
 * Analyzes an error to determine its specific type for better user feedback.
 */
function analyzeApiError(error: any): { type: 'VIDEO_DAILY_LIMIT' | 'HIGH_DEMAND' | 'GENERAL_QUOTA' | 'OTHER' } {
    const errorString = JSON.stringify(error).toLowerCase();
    
    // Check for specific video daily limit first
    if (errorString.includes("limited free generations per day")) {
        return { type: 'VIDEO_DAILY_LIMIT' };
    }
    // Check for general quota/rate limit errors
    if (errorString.includes("quota") || errorString.includes("resource_exhausted") || (error as any)?.error?.code === 429) {
        return { type: 'GENERAL_QUOTA' };
    }
    // Check for high demand/capacity issues
    if (errorString.includes("high demand") || errorString.includes("at capacity")) {
        return { type: 'HIGH_DEMAND' };
    }
    
    return { type: 'OTHER' };
}

// --- CORE FUNCTIONS ---

/**
 * Initializes the application, sets up event listeners, and loads history.
 */
async function init() {
    // Event Listeners
    generateButton.addEventListener('click', handleGenerateClick);
    refreshButton.addEventListener('click', getNewExamplePrompts);
    uploadButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileUpload);
    removeImageButton.addEventListener('click', removeUploadedImage);
    imageModeRadio.addEventListener('change', handleModeChange);
    videoModeRadio.addEventListener('change', handleModeChange);
    historyButton.addEventListener('click', () => historyPanel.classList.add('visible'));
    closeHistoryButton.addEventListener('click', () => historyPanel.classList.remove('visible'));
    promptInput.addEventListener('input', updateUIState);
    termsAgreeButton.addEventListener('click', handleTermsAgree);
    saveApiKeyButton.addEventListener('click', handleSaveApiKey);
    apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSaveApiKey();
    });

    // Initial Setup - UI is disabled until API key is validated
    isGenerating = true; 
    updateUIState();
    
    initIntroAnimation();
    loadHistory();

    const storedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (storedApiKey) {
        await initializeAppWithKey(storedApiKey);
    } else {
        apiKeyModalOverlay.classList.add('visible');
    }
}

/**
 * Initializes the Google AI client and enables the app features after key validation.
 * @param key The Google Gemini API key.
 */
async function initializeAppWithKey(key: string) {
    apiKey = key;
    const tempAi = new GoogleGenAI({ apiKey });

    try {
        // A lightweight check to see if the key is valid by making a simple request.
        await tempAi.models.generateContent({ model: 'gemini-2.5-flash', contents: 'test' });
        
        // Validation succeeded. Set the main 'ai' instance and store the key.
        ai = tempAi;
        localStorage.setItem(API_KEY_STORAGE_KEY, key);

        isGenerating = false;
        await populateExamplePrompts(); 
        handleModeChange();
        updateUIState(); 

        apiKeyModalOverlay.classList.remove('visible');
        setStatus(''); // Clear any previous error status
    } catch (e) {
        console.error("API Key validation failed:", e);
        setStatus('API Key is invalid or has insufficient quota. Please try again.');
        isGenerating = true;
        updateUIState();
        
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        apiKey = null;
        apiKeyInput.value = '';
        apiKeyModalOverlay.classList.add('visible');
    }
}

/**
 * Handles saving the API key from the modal, triggering validation.
 */
async function handleSaveApiKey() {
    const key = apiKeyInput.value.trim();
    if (!key) {
        alert('Please enter an API key.');
        return;
    }

    saveApiKeyButton.disabled = true;
    saveApiKeyButton.textContent = 'Verifying...';
    
    await initializeAppWithKey(key);

    // If initialization failed, the modal is shown again. Re-enable the button.
    if (!ai) { 
      saveApiKeyButton.disabled = false;
      saveApiKeyButton.textContent = 'Save and Start';
    }
}

/**
 * Initializes the intro animation that is triggered on scroll.
 */
function initIntroAnimation() {
    const body = document.body;
    const options = {
        once: true,
        passive: true,
    };
    window.addEventListener('scroll', () => {
        body.classList.add('intro-scrolled');
        showTermsModalIfNeeded();
    }, options);
}

/**
 * Checks if the user has accepted the terms in the current session and shows the modal if not.
 */
function showTermsModalIfNeeded() {
    // Use a short delay to let the main UI animation start gracefully before showing the modal
    setTimeout(() => {
        if (sessionStorage.getItem('termsAccepted') !== 'true' && !apiKeyModalOverlay.classList.contains('visible')) {
            termsModalOverlay.classList.add('visible');
        }
    }, 500); // 500ms delay
}

/**
 * Handles the user agreeing to the terms.
 */
function handleTermsAgree() {
    sessionStorage.setItem('termsAccepted', 'true');
    termsModalOverlay.classList.remove('visible');
}

/**
 * Sets the main status message displayed to the user.
 */
function setStatus(text: string) {
  statusEl.textContent = text;
}

/**
 * Resets the UI to its idle state after a generation task.
 */
function resetUI() {
    isGenerating = false;
    queueStatusContainer.style.display = 'none';
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    updateUIState();
}

/**
 * Updates the state of UI elements based on the application's current state.
 */
function updateUIState() {
  const promptIsEmpty = promptInput.value.trim().length === 0;
  
  // Disable generate button if generating, or if prompt is empty
  generateButton.disabled = isGenerating || promptIsEmpty;

  // Disable mode switching and prompt examples while generating
  imageModeRadio.disabled = isGenerating;
  videoModeRadio.disabled = isGenerating;
  uploadButton.disabled = isGenerating;
  examplePromptsList.classList.toggle('disabled', isGenerating);
  promptInput.disabled = isGenerating;
  refreshButton.disabled = isGenerating || isGeneratingNewPrompts;

  if (isGenerating && ai) { // Only show 'Generating...' if AI is initialized
    generateButton.textContent = 'Generating...';
    generateButton.disabled = true;
  } else if (!ai) { // If AI not ready
    generateButton.textContent = 'Setup Required';
  } else {
    generateButton.textContent = 'Generate';
    if (videoModeRadio.checked && isVideoDailyLimitReached) {
        generateButton.disabled = true;
        setStatus('Daily video limit reached. Try again tomorrow.');
    }
  }

  // Handle prompt placeholder based on uploaded image
  if (uploadedImage) {
      promptInput.placeholder = videoModeRadio.checked
          ? 'Describe how you want to animate this image...'
          : 'Describe how to use this image as inspiration...';
  } else {
      promptInput.placeholder = 'Describe your vision in detail...';
  }
}

/**
 * Handles the click event on the main "Generate" button.
 */
async function handleGenerateClick() {
  if (isGenerating || promptInput.value.trim().length === 0 || !ai) return;

  isGenerating = true;
  updateUIState();
  setStatus('');
  outputPlaceholder.style.display = 'none';
  imageOutput.style.display = 'none';
  videoPlayer.style.display = 'none';
  downloadButton.style.display = 'none';

  try {
    if (videoModeRadio.checked) {
      await generateVideo();
    } else {
      await generateImage();
    }
  } catch (error) {
    console.error('Generation failed:', error);
    const apiError = analyzeApiError(error);

    let errorMessage = 'An unexpected error occurred. Please try again.';

    if (apiError.type === 'VIDEO_DAILY_LIMIT') {
        errorMessage = 'You have reached the daily limit for free video generations. Please try again tomorrow.';
        isVideoDailyLimitReached = true;
    } else if (apiError.type === 'HIGH_DEMAND') {
        errorMessage = 'The service is currently under high demand. Please try again in a few moments.';
    } else if (apiError.type === 'GENERAL_QUOTA') {
        errorMessage = "You've exceeded your API usage quota. Please wait and try again later, or check your Google AI Studio plan and billing details.";
    }

    setStatus(errorMessage);
    outputPlaceholder.style.display = 'block';
    resetUI();
  }
}

/**
 * Generates and displays an image based on the current prompt. If an image is
 * uploaded, it's used as a reference to create a new, more detailed prompt.
 */
async function generateImage() {
    let finalPrompt = promptInput.value;
    const originalUserPrompt = promptInput.value; // Save original for history

    // If an image is uploaded, use it to generate a more descriptive prompt
    if (uploadedImage) {
        setStatus('Analyzing image for inspiration...');
        try {
            const analysisPrompt = `Analyze the provided image and the user's prompt. Create a new, highly detailed and creative prompt for an AI image generator that combines the style, subjects, colors, and composition of the image with the user's instructions. The new prompt should be a standalone instruction, not a conversation. User's prompt: "${originalUserPrompt}"`;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    parts: [
                        { text: analysisPrompt },
                        { inlineData: { mimeType: uploadedImage.mimeType, data: uploadedImage.data } }
                    ]
                }]
            });

            finalPrompt = response.text;
        } catch (error) {
            console.error('Image analysis failed, falling back to original prompt.', error);
            const apiError = analyzeApiError(error);
            if (apiError.type === 'GENERAL_QUOTA') {
                // If analysis fails due to quota, throw to be caught by the main handler
                throw error;
            }
            setStatus('Image analysis failed. Using the original prompt instead.');
            // Fallback to original prompt is already handled as finalPrompt is initialized with it.
        }
    }
    
    setStatus('Generating image...');
    
    const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: finalPrompt, // Use the original or the newly generated prompt
        config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '16:9',
        },
    });

    const imageData = response.generatedImages[0].image.imageBytes;
    const dataUrl = `data:image/jpeg;base64,${imageData}`;

    imageOutput.src = dataUrl;
    imageOutput.style.display = 'block';
    
    downloadButton.href = dataUrl;
    downloadButton.download = `image-${Date.now()}.jpg`;
    downloadButton.style.display = 'inline-block';
    
    addToHistory('image', dataUrl, originalUserPrompt); // Always use the user's prompt for history
    resetUI();
    setStatus('Image generated successfully.');
}

/**
 * Generates a video. Uses an uploaded image as a reference if available,
 * otherwise generates directly from the prompt.
 */
async function generateVideo() {
    const originalUserPrompt = promptInput.value;

    // Build the base request object
    const request: any = {
        model: 'veo-2.0-generate-001',
        prompt: originalUserPrompt,
        config: { numberOfVideos: 1 },
    };

    // If an image is uploaded, add it to the request.
    if (uploadedImage) {
        request.image = {
            mimeType: uploadedImage.mimeType,
            imageBytes: uploadedImage.data
        };
    }
    
    startCountdown(60); // Set a 60-second timeout

    let operation: GenerateVideosOperation = await ai.models.generateVideos(request);
    
    const startTime = Date.now();
    const TIMEOUT_MS = 60000; // 60 seconds

    while (!operation.done && (Date.now() - startTime) < TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10 seconds
        try {
            operation = await ai.operations.getVideosOperation({ operation: operation });
        } catch (e) {
            console.error("Polling failed, but will continue:", e);
            const apiError = analyzeApiError(e);
            if (apiError.type === 'GENERAL_QUOTA') {
                throw e;
            }
        }
    }

    if (!operation.done) {
        setStatus('Video generation timed out after 60 seconds. The model may be under high demand or the request is complex. Please try again later.');
        outputPlaceholder.style.display = 'block';
        resetUI();
        return;
    }

    if (operation.error) {
        console.error('Video generation operation finished with an error:', operation.error);
        throw operation.error;
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) {
        throw new Error("Video URI not found in the successful operation response.");
    }
    
    const videoResponse = await fetch(`${videoUri}&key=${apiKey}`);
    const videoBlob = await videoResponse.blob();
    const videoDataUrl = URL.createObjectURL(videoBlob);
    
    videoPlayer.src = videoDataUrl;
    videoPlayer.style.display = 'block';
    
    downloadButton.href = videoDataUrl;
    downloadButton.download = `video-${Date.now()}.mp4`;
    downloadButton.style.display = 'inline-block';
    
    const reader = new FileReader();
    reader.readAsDataURL(videoBlob); 
    reader.onloadend = function() {
        const base64data = reader.result as string;
        addToHistory('video', base64data, originalUserPrompt);
    }
    
    resetUI();
    setStatus('Video generated successfully.');
}


/**
 * Starts and manages the visual countdown timer in the UI.
 * @param seconds The total duration of the countdown.
 */
function startCountdown(seconds: number) {
    outputPlaceholder.style.display = 'none';
    queueStatusContainer.style.display = 'flex';

    const queueTitle = queueStatusContainer.querySelector('h3');
    const queueDesc = queueStatusContainer.querySelector('p:not(.queue-countdown-text)');

    if (videoModeRadio.checked) {
        if (queueTitle) queueTitle.textContent = "Creating Video...";
        if (queueDesc) queueDesc.textContent = "This process can take up to a minute. Please wait while we bring your idea to life.";
    } else {
        // Fallback for other modes, though not currently used by them
        if (queueTitle) queueTitle.textContent = "Creating Your Vision...";
        if (queueDesc) queueDesc.textContent = "This should only take a moment.";
    }


    if (countdownInterval) clearInterval(countdownInterval);
    
    let remaining = seconds;

    const updateCountdown = () => {
        if (remaining < 0) {
            clearInterval(countdownInterval!);
            return;
        }
        // Format time as M:SS
        const minutes = Math.floor(remaining / 60);
        const secs = remaining % 60;
        queueCountdown.textContent = `Time remaining: ~${minutes}:${secs.toString().padStart(2, '0')}`;
        remaining--;
    };

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000) as unknown as number;
}


/**
 * Populates the example prompts list.
 */
async function populateExamplePrompts() {
  examplePromptsList.innerHTML = '';
  examplePrompts.forEach(prompt => {
    const item = document.createElement('div');
    item.className = 'example-prompt-item';
    item.textContent = prompt;
    item.addEventListener('click', () => {
      promptInput.value = prompt;
      updateUIState();
    });
    examplePromptsList.appendChild(item);
  });
}

/**
 * Fetches new creative prompts from the Gemini API.
 */
async function getNewExamplePrompts() {
    if (!ai) return; // Don't run if AI is not initialized
    isGeneratingNewPrompts = true;
    refreshButton.classList.add('loading');
    updateUIState();

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Generate 5 fresh, creative, and visually interesting prompts for an AI image/video generator. The prompts should be diverse and inspiring.',
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        prompts: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        }
                    }
                }
            }
        });
        
        const result = JSON.parse(response.text);
        if (result.prompts && result.prompts.length > 0) {
            examplePrompts = result.prompts;
            await populateExamplePrompts();
            setStatus(''); // Clear any previous error message
        }
    } catch (error) {
        console.error("Failed to get new prompts:", error);
        const apiError = analyzeApiError(error);
        if (apiError.type === 'GENERAL_QUOTA') {
            setStatus("Could not fetch new examples due to API quota limits.");
        } else {
            setStatus("Could not fetch new examples at this time.");
        }
    } finally {
        isGeneratingNewPrompts = false;
        refreshButton.classList.remove('loading');
        updateUIState();
    }
}

/**
 * Handles the file upload event.
 */
function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const base64Data = dataUrl.split(',')[1];
        
        uploadedImage = { data: base64Data, mimeType: file.type };

        imagePreview.src = dataUrl;
        imagePreviewContainer.style.display = 'block';
        updateUIState();
    };
    reader.readAsDataURL(file);
    fileInput.value = ''; // Reset for next upload
}

/**
 * Removes the currently uploaded image.
 */
function removeUploadedImage() {
    uploadedImage = null;
    imagePreview.src = '';
    imagePreviewContainer.style.display = 'none';
    updateUIState();
}

/**
 * Adjusts UI elements based on the selected generation mode (image/video).
 */
function handleModeChange() {
    updateUIState();
}

// --- HISTORY FUNCTIONS ---
const HISTORY_KEY = 'ai-veo-history';

function loadHistory() {
    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
        history = JSON.parse(savedHistory);
    }
    renderHistory();
}

function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addToHistory(type: 'image' | 'video', dataUrl: string, prompt: string) {
    const newItem: HistoryItem = {
        id: `history-${Date.now()}`,
        type,
        dataUrl,
        prompt
    };
    history.unshift(newItem); // Add to the beginning
    if (history.length > 20) { // Keep history capped
        history.pop();
    }
    saveHistory();
    renderHistory();
}

function renderHistory() {
    historyGrid.innerHTML = '';
    if (history.length === 0) {
        historyGrid.innerHTML = '<p class="history-empty">Your generated content will appear here.</p>';
        return;
    }

    history.forEach(item => {
        const historyItemEl = document.createElement('div');
        historyItemEl.className = 'history-item';
        historyItemEl.innerHTML = `
            <div class="history-item-preview">
                ${item.type === 'image'
                    ? `<img src="${item.dataUrl}" alt="Generated image">`
                    : `<video src="${item.dataUrl}" muted loop onmouseover="this.play()" onmouseout="this.pause();this.currentTime=0;"></video>`
                }
            </div>
            <div class="history-item-info">
                <p class="history-item-prompt">${item.prompt}</p>
                <div class="history-item-actions">
                    <button class="copy-prompt-button" data-prompt="${item.prompt}">Copy Prompt</button>
                    <a href="${item.dataUrl}" class="download-button" download="${item.type}-${item.id}.${item.type === 'image' ? 'jpg' : 'mp4'}">Download</a>
                </div>
            </div>
        `;
        historyGrid.appendChild(historyItemEl);
    });

    historyGrid.querySelectorAll('.copy-prompt-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const prompt = (e.currentTarget as HTMLElement).dataset.prompt;
            if (prompt) {
                navigator.clipboard.writeText(prompt);
                (e.currentTarget as HTMLElement).textContent = 'Copied!';
                setTimeout(() => {
                    (e.currentTarget as HTMLElement).textContent = 'Copy Prompt';
                }, 1500);
            }
        });
    });
}


// --- INITIALIZATION ---
init();