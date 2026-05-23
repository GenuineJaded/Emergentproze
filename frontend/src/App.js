import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Geometry from "@/pages/Geometry";
import Mercurius from "@/pages/Mercurius";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/geometry" element={<Geometry />} />
          <Route path="/mercurius" element={<Mercurius />} />
          <Route path="/companion" element={<Mercurius />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
