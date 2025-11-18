window.addEventListener('load', () => {               
  // Service Worker for Dynamic Quiz Generator
  const CACHE_NAME = "dynamic-quiz-v1";

  // List of files to cache immediately upon installation
  const urlsToCache = [
    "./quiz.html",
    "./quiz.css",
    "./quiz.js",
    // The favicon for a complete offline experience
    "./images/favicon.ico",
    // External dependencies
    "https://unpkg.com/lucide@latest",
    "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js",
  ];

  // Installation: Cache all essential assets
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        console.log("Service Worker: Caching assets");
        return cache.addAll(urlsToCache);
      })
    );
  });

  // Activation: Clean up old caches
  self.addEventListener("activate", (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              console.log("Service Worker: Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
    );
  });

  // Fetch: Serve assets from cache, fall back to network
  self.addEventListener("fetch", (event) => {
    event.respondWith(
      caches.match(event.request).then((response) => {
        // Return cached response if found
        if (response) {
          return response;
        }

        // Important: Clone the request. A request is a stream and can only be consumed once.
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then((fetchResponse) => {
          // Check if we received a valid response
          if (
            !fetchResponse ||
            fetchResponse.status !== 200 ||
            fetchResponse.type !== "basic"
          ) {
            return fetchResponse;
          }

          // Important: Clone the response. A response is a stream and can only be consumed once.
          // We consume the original response to return it to the browser, and clone the response
          // to add it to the cache.
          const responseToCache = fetchResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            // Only cache GET requests
            if (event.request.method === "GET") {
              // Do not cache the Gemini API URL
              if (
                !event.request.url.includes("generativelanguage.googleapis.com")
              ) {
                cache.put(event.request, responseToCache);
              }
            }
          });

          return fetchResponse;
        });
      })
    );
  });
})
