import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AvatarSelect from './screens/AvatarSelect.jsx';
import KidHome from './screens/KidHome.jsx';
import ParentDashboard from './screens/ParentDashboard.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AvatarSelect />} />
        <Route path="/kid/:kidId" element={<KidHome />} />
        <Route path="/parent" element={<ParentDashboard />} />
        <Route path="*" element={<AvatarSelect />} />
      </Routes>
    </BrowserRouter>
  );
}
