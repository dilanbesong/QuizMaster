// ====================================================================
// === CORE CONFIGURATION: PASTE YOUR API KEY HERE ===
// ====================================================================

/**
 * IMPORTANT: To run this application locally, you must paste your Gemini API Key
 * below. You can get a key from Google AI Studio.
 */
//const API_KEY = "[NETLIFY_GEMINI_API_KEY]"; // <-- PASTE YOUR GEMINI API KEY HERE
const API_KEY = "AIzaSyDZVi8wmAwtpVCur-qPGFPgFfIGkc0tqsg";

// --- Gemini API Configuration ---
const GENERATE_MODEL = "gemini-2.5-flash-preview-09-2025";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GENERATE_MODEL}:generateContent?key=${API_KEY}`;
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${API_KEY}`;

// JSON Schema for structured quiz output
const QUIZ_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "NUMBER" },
      question: {
        type: "STRING",
        description: "The quiz question, using LaTeX syntax where appropriate.",
      },
      options: {
        type: "ARRAY",
        items: { type: "STRING" },
        description:
          "Exactly four multiple-choice options, using LaTeX syntax where appropriate.",
      },
      answer: {
        type: "STRING",
        description: "The correct option from the 'options' list.",
      },
      solution: {
        type: "STRING",
        description:
          "A detailed, step-by-step solution for the question, using LaTeX syntax.",
      },
    },
    required: ["id", "question", "options", "answer", "solution"],
  },
};

// --- Global State ---
let timerInterval;
const TOTAL_TIME_SECONDS = 601; // 10 minutes and 1 second
let timeLeft = TOTAL_TIME_SECONDS;
let quizData = [];
let userAnswers = [];
let currentQuestionIndex = 0;
let isReviewMode = false;
let audioContext; // Global AudioContext instance
let audioSource; // Global AudioBufferSourceNode instance

// --- DOM Elements ---
const startBtn = document.getElementById("start-btn");
const inputCard = document.getElementById("input-card");
const quizCard = document.getElementById("quiz-card");
const loadingMessage = document.getElementById("loading-message");
const questionTrack = document.getElementById("question-track");
const qNumberEl = document.getElementById("q-number");
const qTextEl = document.getElementById("q-text");
const nextBtn = document.getElementById("next-btn");
const prevBtn = document.getElementById("prev-btn");
const submitBtn = document.getElementById("submit-btn");
const timeEl = document.getElementById("time-left");
const timerEl = document.getElementById("timer");
const statusBar = document.getElementById("status-bar");
const scoreModal = document.getElementById("score-modal");
const finalScoreEl = document.getElementById("final-score");
const modalActionBtn = document.getElementById("modal-action-btn");
const reviewSolutionEl = document.getElementById("review-solution");
const solutionTextEl = document.getElementById("solution-text");

const readQuestionBtn = document.getElementById("read-question-btn");
const readBtnText = document.getElementById("read-btn-text");
const restartBtn = document.getElementById("restart-btn"); // New restart button

const navLinks = document.querySelectorAll(".nav-link");
const quizSection = document.getElementById("quiz-section");
const aboutSection = document.getElementById("about-section");

const themeToggleBtn = document.getElementById("theme-toggle");
const moonIcon = document.getElementById("moon-icon");
const sunIcon = document.getElementById("sun-icon");

// --- Utility Functions ---

/**
 * Custom function to display an error message in the UI instead of using alert().
 * @param {string} message
 */
function showCustomError(message) {
  const errorEl = document.getElementById("error-message");
  document.getElementById("error-text").textContent = message;
  errorEl.classList.remove("hidden");
  // Hide after 8 seconds
  setTimeout(() => errorEl.classList.add("hidden"), 8000);
}

/**
 * Converts Base64 string to ArrayBuffer.
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Converts 16-bit PCM audio data to a WAV Blob.
 * @param {Int16Array} pcm16
 * @param {number} sampleRate
 * @returns {Blob}
 */
function pcmToWav(pcm16, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const buffer = new ArrayBuffer(44 + pcm16.byteLength);
  const view = new DataView(buffer);
  let offset = 0;

  // RIFF chunk
  view.setUint32(offset, 0x52494646, false);
  offset += 4; // 'RIFF'
  view.setUint32(offset, 36 + pcm16.byteLength, true);
  offset += 4; // ChunkSize
  view.setUint32(offset, 0x57415645, false);
  offset += 4; // 'WAVE'

  // FMT chunk
  view.setUint32(offset, 0x666d7420, false);
  offset += 4; // 'fmt '
  view.setUint32(offset, 16, true);
  offset += 4; // Subchunk1Size (16 for PCM)
  view.setUint16(offset, 1, true);
  offset += 2; // AudioFormat (1 for PCM)
  view.setUint16(offset, numChannels, true);
  offset += 2; // NumChannels
  view.setUint32(offset, sampleRate, true);
  offset += 4; // SampleRate
  view.setUint32(offset, byteRate, true);
  offset += 4; // ByteRate
  view.setUint16(offset, blockAlign, true);
  offset += 2; // BlockAlign
  view.setUint16(offset, bitsPerSample, true);
  offset += 2; // BitsPerSample

  // DATA chunk
  view.setUint32(offset, 0x64617461, false);
  offset += 4; // 'data'
  view.setUint32(offset, pcm16.byteLength, true);
  offset += 4; // Subchunk2Size

  // Write PCM data
  for (let i = 0; i < pcm16.length; i++) {
    view.setInt16(offset, pcm16[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Handles exponential backoff for API calls.
 * @param {function} fn The function to execute.
 * @param {number} maxRetries Maximum number of retries.
 */
async function withRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Renders LaTeX/MathJax in a given element.
 * @param {HTMLElement} el
 */
function renderMath(el) {
  if (window.MathJax) {
    // Ensure MathJax is configured to process the element's content
    window.MathJax.typesetPromise([el]).catch((err) =>
      console.error("MathJax error:", err)
    );
  }
}

// --- TTS Functions ---

/**
 * Plays audio data decoded from raw PCM ArrayBuffer.
 * @param {ArrayBuffer} audioBuffer - The raw PCM audio data.
 * @param {number} sampleRate - The sample rate of the audio.
 */
function playAudioFromPCM(audioBuffer, sampleRate) {
  stopAudio(); // Stop any currently playing audio

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  // API returns signed PCM16 audio data, which we convert to a float buffer
  const pcm16 = new Int16Array(audioBuffer);
  const floatArray = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    floatArray[i] = pcm16[i] / 32768; // Convert 16-bit int to float32
  }

  const buffer = audioContext.createBuffer(1, floatArray.length, sampleRate);
  buffer.copyToChannel(floatArray, 0);

  audioSource = audioContext.createBufferSource();
  audioSource.buffer = buffer;
  audioSource.connect(audioContext.destination);

  audioSource.onended = () => {
    readBtnText.textContent = "Read Question";
    readQuestionBtn.disabled = false;
  };

  audioSource.start(0);
}

/**
 * Stops any currently playing audio.
 */
function stopAudio() {
  if (audioSource) {
    audioSource.stop();
    audioSource.disconnect();
    audioSource = null;
  }
  readBtnText.textContent = "Read Question";
  readQuestionBtn.disabled = false;
}

/**
 * Initiates the TTS call for the current question.
 */
async function readCurrentQuestion() {
  if (!API_KEY) {
    showCustomError(
      "Please paste your Gemini API Key into the 'API_KEY' variable."
    );
    return;
  }

  const question = quizData[currentQuestionIndex];
  if (!question || !question.question) return;

  // 1. Prepare the text: Remove LaTeX markers for better pronunciation.
  const rawText = question.question
    .replace(/\$\$(.*?)\$\$/g, " equation ") // Replace display math
    .replace(/\$(.*?)\$/g, " equation "); // Replace inline math

  // 2. Construct the prompt for the TTS model
  const ttsPrompt = `Read the following quiz question: ${rawText}`;

  // 3. UI update
  readBtnText.textContent = "Loading Audio...";
  readQuestionBtn.disabled = true;

  const payload = {
    contents: [{ parts: [{ text: ttsPrompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          // Using the 'Kore' voice for clear delivery
          prebuiltVoiceConfig: { voiceName: "Kore" },
        },
      },
    },
  };

  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };

  try {
    const response = await withRetry(() => fetch(TTS_URL, options));

    if (!response.ok) {
      throw new Error(`TTS API failed with status ${response.status}`);
    }

    const result = await response.json();
    const part = result?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (audioData && mimeType && mimeType.startsWith("audio/")) {
      // MimeType example: "audio/L16;rate=24000"
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;

      const pcmData = base64ToArrayBuffer(audioData);

      readBtnText.textContent = "Playing...";
      playAudioFromPCM(pcmData, sampleRate);
    } else {
      throw new Error("TTS response missing audio data.");
    }
  } catch (error) {
    console.error("Voice-Over failed:", error);
    showCustomError(`Voice-Over failed: ${error.message}.`);
    readBtnText.textContent = "Read Question";
    readQuestionBtn.disabled = false;
  }
}

// --- Timer and Score Functions ---

/**
 * Formats seconds into MM:SS string.
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}`;
}

function startTimer() {
  timeLeft = TOTAL_TIME_SECONDS;
  timerEl.classList.remove("hidden");
  timeEl.textContent = formatTime(timeLeft - 1); // Display 10:00 initially

  clearInterval(timerInterval); // Clear any existing interval

  timerInterval = setInterval(() => {
    timeLeft--;
    timeEl.textContent = formatTime(timeLeft);

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      calculateAndDisplayScore(true); // Auto-submit on timeout
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

/**
 * Calculates final score and shows the modal.
 * @param {boolean} isTimeout If the submission was due to a timeout.
 */
function calculateAndDisplayScore(isTimeout) {
  stopTimer();
  stopAudio(); // Stop audio on submission
  let correctCount = 0;

  quizData.forEach((q, index) => {
    const userAnswer = userAnswers[index];
    if (userAnswer && userAnswer === q.answer) {
      correctCount++;
    }
  });

  finalScoreEl.textContent = `${correctCount}/${quizData.length}`;
  finalScoreEl.style.color =
    correctCount >= quizData.length * 0.7
      ? "var(--color-green-btn)"
      : "#ef4444"; // Red for low score

  scoreModal.classList.remove("hidden");
  document.querySelector(".score-title").textContent = isTimeout
    ? "Time's Up!"
    : "Quiz Complete!";
  modalActionBtn.textContent = "Review Answers";

  // Set up review button handler
  modalActionBtn.onclick = () => {
    scoreModal.classList.add("hidden");
    enterReviewMode();
  };
}

// --- Core Quiz Logic ---

/**
 * Renders the current question based on currentQuestionIndex.
 */
function updateUI() {
  if (quizData.length === 0) return;

  const question = quizData[currentQuestionIndex];
  const totalQuestions = quizData.length;
  const optionsMap = ["A", "B", "C", "D"];

  stopAudio(); // Stop audio when changing question
  readQuestionBtn.disabled = false;

  // 1. Update question number
  qNumberEl.textContent = `Question ${
    currentQuestionIndex + 1
  } of ${totalQuestions}`;

  // 2. Update question text
  qTextEl.innerHTML = question.question;
  renderMath(qTextEl); // Render MathJax on question

  // 3. Update answer options
  questionTrack.innerHTML = ""; // Clear previous options
  const userAnswer = userAnswers[currentQuestionIndex];

  question.options.forEach((option, idx) => {
    const letter = optionsMap[idx];
    const li = document.createElement("li");
    li.className = "answer-option";
    li.dataset.option = option;

    let optionContent = `<span class="option-label">${letter}</span><span class="option-text">${option}</span>`;

    // Review Mode Logic
    if (isReviewMode) {
      li.style.cursor = "default";

      if (option === question.answer) {
        // Correct answer
        li.classList.add("correct-answer");
        optionContent = `<span class="option-label"><i data-lucide="check" style="width:16px;"></i></span><span class="option-text">${option}</span>`;
      } else if (option === userAnswer) {
        // Incorrectly selected answer
        li.classList.add("incorrect-answer");
        optionContent = `<span class="option-label"><i data-lucide="x" style="width:16px;"></i></span><span class="option-text">${option}</span>`;
      }
    }

    // Normal Quiz Mode Logic
    if (!isReviewMode) {
      if (userAnswer === option) {
        li.classList.add("selected");
      }
      li.addEventListener("click", handleAnswerSelection);
    }

    li.innerHTML = optionContent;
    questionTrack.appendChild(li);

    // Render MathJax on the option text
    const optionTextEl = li.querySelector(".option-text");
    if (optionTextEl) {
      renderMath(optionTextEl);
    }
  });

  // Re-render lucide icons for new elements (like check/x marks)
  if (isReviewMode) {
    lucide.createIcons();
    reviewSolutionEl.classList.remove("hidden");
    solutionTextEl.innerHTML = question.solution;
    renderMath(solutionTextEl); // Render MathJax on solution
  } else {
    reviewSolutionEl.classList.add("hidden");
  }

  // 4. Update pagination and buttons
  prevBtn.disabled = currentQuestionIndex === 0;
  nextBtn.disabled = currentQuestionIndex === totalQuestions - 1;

  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;
  nextBtn.classList.toggle("hidden", isLastQuestion);
  submitBtn.classList.toggle("hidden", !isLastQuestion || isReviewMode);

  // 5. Update status bar
  updateStatusBar();
}

/**
 * Generates and updates the question status bar at the bottom.
 */
function updateStatusBar() {
  statusBar.innerHTML = "";
  quizData.forEach((q, index) => {
    const indicator = document.createElement("div");
    indicator.className = "status-indicator";
    indicator.textContent = index + 1;
    indicator.dataset.index = index;

    if (isReviewMode) {
      const userAnswer = userAnswers[index];
      if (userAnswer === q.answer) {
        indicator.classList.add("review-indicator-correct");
      } else if (userAnswer) {
        indicator.classList.add("review-indicator-incorrect");
      } else {
        indicator.classList.add("review-indicator-unanswered");
      }
    } else if (userAnswers[index]) {
      indicator.classList.add("answered");
    }

    if (index === currentQuestionIndex) {
      indicator.classList.add("current");
    }

    indicator.addEventListener("click", () => {
      currentQuestionIndex = index;
      updateUI();
    });
    statusBar.appendChild(indicator);
  });
}

/**
 * Stores the user's answer and updates the UI.
 * @param {Event} e
 */
function handleAnswerSelection(e) {
  if (isReviewMode) return;

  const selectedOptionEl = e.target.closest(".answer-option");
  if (!selectedOptionEl) return;

  // Remove 'selected' from all other options
  questionTrack.querySelectorAll(".answer-option").forEach((el) => {
    el.classList.remove("selected");
  });

  // Add 'selected' to the clicked option
  selectedOptionEl.classList.add("selected");

  // Save the answer
  userAnswers[currentQuestionIndex] = selectedOptionEl.dataset.option;

  // Update the status bar
  updateStatusBar();
}

/**
 * Moves to the next question.
 */
function handleNext() {
  if (currentQuestionIndex < quizData.length - 1) {
    currentQuestionIndex++;
    updateUI();
  }
}

/**
 * Switches the display to Review Mode.
 */
function enterReviewMode() {
  isReviewMode = true;
  currentQuestionIndex = 0; // Start review from the first question
  stopTimer();
  stopAudio();
  timerEl.classList.add("hidden");

  // Hide quiz generation card
  inputCard.classList.add("hidden");
  quizCard.classList.remove("hidden");

  // Change button text for review navigation
  nextBtn.innerHTML = 'Next <i data-lucide="arrow-right"></i>';
  prevBtn.innerHTML = '<i data-lucide="arrow-left"></i> Previous';

  // Show both prev/next buttons and hide submit
  prevBtn.classList.remove("hidden");
  nextBtn.classList.remove("hidden");
  submitBtn.classList.add("hidden");

  // Update all button icons
  lucide.createIcons();

  // Set up review flow: go back to quiz generation when review is complete
  nextBtn.onclick = () => {
    if (currentQuestionIndex < quizData.length - 1) {
      currentQuestionIndex++;
      updateUI();
    } else {
      // Review finished, go back to start screen
      isReviewMode = false;
      initializeQuiz();
    }
  };
  prevBtn.onclick = () => {
    if (currentQuestionIndex > 0) {
      currentQuestionIndex--;
      updateUI();
    }
  };

  updateUI(); // Render the first question in review mode
}

/**
 * Fetches a quiz from the Gemini API.
 */
async function fetchQuiz(topic, numQuestions, difficulty) {
  const systemPrompt = `You are an expert quiz generator. Your task is to create a multiple-choice quiz based on the user's topic.
            The quiz MUST adhere to the following rules:
            1. Generate exactly ${numQuestions} distinct questions.
            2. Each question MUST have exactly four options.
            3. The 'answer' field MUST be one of the strings from the 'options' list.
            4. The 'question', 'options', and 'solution' fields MUST use LaTeX syntax for all mathematical, chemical, and scientific expressions, enclosed in dollar signs ($...$ or $$...$$). For example: The equation for the period of a pendulum is $T = 2\pi\sqrt{\\frac{L}{g}}$.
            5. The difficulty level should be suitable for a ${difficulty} audience.`;

  const userQuery = `Generate a ${numQuestions}-question, multiple-choice quiz on the topic: ${topic}. Difficulty: ${difficulty}.`;

  const payload = {
    contents: [{ parts: [{ text: userQuery }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: QUIZ_SCHEMA,
    },
  };

  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };

  const response = await withRetry(() => fetch(GENERATE_URL, options));

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API Request failed with status ${response.status}: ${errorBody}`
    );
  }

  const result = await response.json();

  const content = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error("API response was empty or malformed.");
  }

  // The model returns a JSON string, which must be parsed
  const parsedQuizData = JSON.parse(content);

  // Filter out any potential non-object elements, though the schema should prevent this
  return parsedQuizData.filter(
    (item) => typeof item === "object" && item !== null
  );
}

/**
 * Main function to start the quiz generation process.
 */
async function startQuiz() {
  // Check for API Key
  if (!API_KEY) {
    showCustomError(
      "Please paste your Gemini API Key into the 'API_KEY' variable at the beginning of the script to run this app."
    );
    return; // Stop execution
  }

  const topic = document.getElementById("topic").value.trim();
  const numQuestions = parseInt(document.getElementById("num-questions").value);
  const difficulty =
    document.getElementById("difficulty").value.trim() || "General";

  if (!topic || numQuestions < 1 || numQuestions > 10) {
    showCustomError(
      "Please enter a valid topic and number of questions (1-10)."
    );
    return;
  }

  // UI State: Show loading, hide input
  inputCard.classList.add("hidden");
  quizCard.classList.remove("hidden");
  loadingMessage.classList.remove("hidden");

  try {
    quizData = await fetchQuiz(topic, numQuestions, difficulty);

    // Reset state
    currentQuestionIndex = 0;
    userAnswers = new Array(quizData.length).fill(null);
    isReviewMode = false;

    // UI State: Hide loading, start quiz
    loadingMessage.classList.add("hidden");

    // Reset buttons for quiz-taking mode
    nextBtn.innerHTML = 'Next <i data-lucide="arrow-right"></i>';
    prevBtn.innerHTML = '<i data-lucide="arrow-left"></i> Previous';
    prevBtn.onclick = () => {
      stopAudio();
      if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        updateUI();
      }
    };
    nextBtn.onclick = handleNext;
    submitBtn.onclick = () => calculateAndDisplayScore(false);

    startTimer();
    updateUI();
  } catch (error) {
    console.error("Failed to generate quiz:", error);
    loadingMessage.classList.add("hidden");
    showCustomError(
      `Failed to generate quiz. Check console for details. Error: ${error.message}`
    );
    // Go back to input screen
    quizCard.classList.add("hidden");
    inputCard.classList.remove("hidden");
    stopTimer();
  }
}

/**
 * Resets the UI and state to the initial quiz generation screen.
 */
function initializeQuiz() {
  // Reset state
  quizData = [];
  userAnswers = [];
  currentQuestionIndex = 0;
  isReviewMode = false;
  stopTimer();
  stopAudio();

  // Hide everything except the input card
  inputCard.classList.remove("hidden");
  quizCard.classList.add("hidden");
  scoreModal.classList.add("hidden");
  timerEl.classList.add("hidden");

  // Ensure we are on the 'quiz' page
  navigateTo("quiz");
}

// --- Navigation and Theme ---

/**
 * Handles the display of different sections (Quiz vs. About).
 * @param {string} page 'quiz' or 'about'
 */
function navigateTo(page) {
  navLinks.forEach((link) => {
    // Only toggle 'active' class for the link element itself
    if (link.dataset.page) {
      link.classList.toggle("active", link.dataset.page === page);
    }
  });

  quizSection.classList.toggle("hidden", page !== "quiz");
  aboutSection.classList.toggle("hidden", page !== "about");
}

// --- Event Handlers Setup ---

window.addEventListener("load", () => {
  // Attach navigation listeners
  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(e.target.dataset.page);
    });
  });

  // Initial setup
  initializeQuiz();
  lucide.createIcons();

  // Check for system color scheme preference and apply dark mode if needed
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (prefersDark) {
    document.documentElement.classList.add("dark");
    moonIcon.classList.add("hidden");
    sunIcon.classList.remove("hidden");
  }
});

// Quiz button handlers
readQuestionBtn.addEventListener("click", readCurrentQuestion);
nextBtn.addEventListener("click", handleNext);
// Note: prevBtn and nextBtn click handlers are reset in startQuiz and enterReviewMode

submitBtn.addEventListener("click", () => calculateAndDisplayScore(false));
startBtn.addEventListener("click", startQuiz);
questionTrack.addEventListener("click", handleAnswerSelection); // Use click delegation on parent
restartBtn.addEventListener("click", initializeQuiz); // New restart button handler

// Theme Toggle
themeToggleBtn.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");
  const isDark = document.documentElement.classList.contains("dark");

  if (isDark) {
    moonIcon.classList.add("hidden");
    sunIcon.classList.remove("hidden");
  } else {
    moonIcon.classList.remove("hidden");
    sunIcon.classList.add("hidden");
  }
});
