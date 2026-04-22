# Pitch-Detection Singing Game

I want to create a music game just like the one on TikTok, where a floating ball hovers on a path and needs to go through a hole to keep going. The ball moves up and down based on the voice of the person. The person needs to sing at the right pitch to make the ball go through the hole. Features I need:

- Options for different major and minor keys
- Web-based application, but must be user-friendly and compatible on handheld devices
- Maximum concurrent users: 50
- 2 acceptable pitches for each note (down octave and normal octave)


## Setup

Terminal commands to run:
> `npm install`
> `npm run dev`
> `npm install pitchy` for pitch detection

---

File Structure:

Music-Game/
|-- index.html
|-- package.json
|-- vite.config.js
|-- .gitignore
|-- README.md
|-- SPECIFICATION.md
|-- src/
    |-- main.jsx
    |-- App.jsx
    |-- index.css
    |-- components/
        |-- Layout.jsx
        |-- StartScreen.jsx
    |-- audio/
    |-- game/
    |-- hooks/
    |-- utils/

## Design
