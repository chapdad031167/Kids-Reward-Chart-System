import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { api } from './api.js';
import AvatarSelect from './screens/AvatarSelect.jsx';
import KidHome from './screens/KidHome.jsx';
import ParentDashboard from './screens/ParentDashboard.jsx';
import Setup from './screens/Setup.jsx';

export default function App() {
  const [status, setStatus] = useState(null); // { configured, appName }

  const refresh = useCallback(() => {
    api
      .get('/api/setup-status')
      .then((s) => {
        setStatus(s);
        if (s.appName) document.title = s.appName;
      })
      .catch(() => setStatus({ configured: true, appName: 'Reward Chart' }));
  }, []);

  useEffect(refresh, [refresh]);

  if (!status) return <div className="pin-screen">Loading…</div>;

  if (!status.configured) {
    return <Setup onDone={refresh} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AvatarSelect appName={status.appName} onAppNameChange={refresh} />} />
        <Route path="/kid/:kidId" element={<KidHome />} />
        <Route path="/parent" element={<ParentDashboard onAppNameChange={refresh} />} />
        <Route path="*" element={<AvatarSelect appName={status.appName} onAppNameChange={refresh} />} />
      </Routes>
    </BrowserRouter>
  );
}
