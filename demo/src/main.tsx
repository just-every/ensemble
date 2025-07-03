import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import DemoLauncher from './DemoLauncher';
import SimpleRequestDemo from './SimpleRequestDemo';
import VoiceDemo from './VoiceDemo';
import EmbedDemo from './EmbedDemo';
import ListenDemo from './ListenDemo';

const App = () => {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<DemoLauncher />} />
                <Route path="/request" element={<SimpleRequestDemo />} />
                <Route path="/voice" element={<VoiceDemo />} />
                <Route path="/embed" element={<EmbedDemo />} />
                <Route path="/listen" element={<ListenDemo />} />
            </Routes>
        </BrowserRouter>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
