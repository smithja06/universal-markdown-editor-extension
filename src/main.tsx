import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import './styles.css'
import App from './App'
import { browserHost } from './host/browser'

createRoot(document.getElementById('root')!).render(<App host={browserHost} />)
