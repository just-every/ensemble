import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import DemoLauncher from './DemoLauncher';
import RequestDemo from './RequestDemo';
import RequestDemoNew from './RequestDemoNew';
import VoiceDemo from './VoiceDemo';
import EmbedDemo from './EmbedDemo';
import ListenDemo from './ListenDemo';
import '@just-every/demo-ui/dist/styles.css';

const App = () => {
    return (
        <BrowserRouter>
            <Layout>
                <Routes>
                    <Route path="/" element={<DemoLauncher />} />
                    <Route path="/request" element={<RequestDemoNew />} />
                    <Route path="/request-old" element={<RequestDemo />} />
                    <Route path="/voice" element={<VoiceDemo />} />
                    <Route path="/embed" element={<EmbedDemo />} />
                    <Route path="/listen" element={<ListenDemo />} />
                </Routes>
            </Layout>
        </BrowserRouter>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
