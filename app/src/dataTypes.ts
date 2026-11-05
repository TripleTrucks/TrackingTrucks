export interface Truck {
  id: number;
  truckname: string;
  tags: string[];
  profileIds: number[];
  scheduleIds: number[];
}

export interface Profile {
  id: number;
  displayname: string;
  truckIds: number[];
}
