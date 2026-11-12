export interface Truck {
  id: number;
  truckname: string;
  tags: string[];
  "social-media"?: SocialMediaLink[];
  profileIds: number[];
  scheduleIds: number[];
}

export interface SocialMediaLink {
  platform: string;
  url: string;
}

export interface Profile {
  id: number;
  displayname: string;
  truckIds: number[];
}
