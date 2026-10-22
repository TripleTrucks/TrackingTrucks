import { useState } from "react";
import "./Home.css";

import Navbar from "./components/Navbar";
import MapView from "./components/MapView";
import SideBar from "./components/SideBar";

export interface Truck {
  id: number;
  truckname: string;
  tags: string[];
  profileIds: number[];
  scheduleIds: number[];
}

function Home() {
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);
  const [visibleTrucks, setVisibleTrucks] = useState<Truck[]>([]);

  return (
    <div className="home">
      <Navbar />

      <div className="main-layout">
        <SideBar
          selectedTruck={selectedTruck}
          visibleTrucks={visibleTrucks}
          onTruckSelect={setSelectedTruck}
        />

        <MapView
          selectedTruck={selectedTruck}
          onTruckSelect={setSelectedTruck}
          onVisibleTrucksChange={setVisibleTrucks}
        />
      </div>
    </div>
  );
}

export default Home;