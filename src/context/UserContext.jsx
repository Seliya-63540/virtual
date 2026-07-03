import React, { createContext } from 'react'
import run from '../gemini.js'
export const datacontext = createContext()


function UserContext({children}) {
function speak(text){
    let text_speak = new SpeechSynthesisUtterance(text)
    text_speak.volume=1
    text_speak.rate=1
    text_speak.pitch=1
    text_speak.lang='hi-GB'
    window.speechSynthesis.speak(text_speak)
}
async function aiResponse(prompt){
    try {
        let text = await run(prompt)
        speak(text)
        console.log(text)
    } catch (error) {
        console.error('AI response failed:', error)
        speak('Sorry, I am unable to respond right now. Please try again later.')
    }
}
let speechrecognition = window.SpeechRecognition || window.webkitSpeechRecognition
let recognition = new speechrecognition()
recognition.onresult = (e) => {
    let currentIndex = e.resultIndex
    let transcript = e.results[currentIndex][0].transcript
    console.log(transcript)
    aiResponse(transcript)
}
recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error)
}
    let value={
       recognition
    }
  return (
    <div>
        <datacontext.Provider value={value}>
        {children}
        </datacontext.Provider>
    </div>
  )
}

export default UserContext