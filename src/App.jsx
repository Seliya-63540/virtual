import React, { useContext } from 'react'
import './App.css'
import logo from './assets/ai.png'
import { CiMicrophoneOn } from "react-icons/ci";
import { datacontext } from './context/UserContext.jsx'

const App = () => {
  let { recognition } = useContext(datacontext)

  return (
    <div className='main'>
      <img src={logo} alt="logo" className='main_img' />
      <span className='title'>I am your virtual assistant</span>
      <button onClick={() => {
        recognition.start()
      }}>Click here <CiMicrophoneOn /></button>
    </div>
  )
}

export default App