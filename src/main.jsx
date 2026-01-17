import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx' // Make sure the .jsx extension is here
import './index.css' // (Optional, remove this line if you don't have a css file)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)