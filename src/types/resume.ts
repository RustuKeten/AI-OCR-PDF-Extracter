// Type definitions for Resume JSON structure

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "INTERNSHIP" | "CONTRACT";
export type LocationType = "ONSITE" | "REMOTE" | "HYBRID";
export type DegreeType = "HIGH_SCHOOL" | "ASSOCIATE" | "BACHELOR" | "MASTER" | "DOCTORATE";
export type LanguageLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "NATIVE";

export interface Profile {
  name: string;
  surname: string;
  email: string;
  headline: string;
  professionalSummary: string;
  linkedIn: string | null;
  website: string | null;
  country: string;
  city: string;
  relocation: boolean;
  remote: boolean;
}

export interface WorkExperience {
  jobTitle: string;
  employmentType: EmploymentType;
  locationType: LocationType;
  company: string;
  startMonth: number; // 1-12
  startYear: number;
  endMonth: number | null;
  endYear: number | null;
  current: boolean;
  description: string;
}

export interface Education {
  school: string;
  degree: DegreeType;
  major: string;
  startYear: number;
  endYear: number;
  current: boolean;
  description: string;
}

export interface License {
  name: string;
  issuer: string;
  issueYear: number;
  description: string;
}

export interface Language {
  language: string;
  level: LanguageLevel;
}

export interface Achievement {
  title: string;
  organization: string;
  achieveDate: string; // YYYY-MM format
  description: string;
}

export interface Publication {
  title: string;
  publisher: string;
  publicationDate: string; // ISO8601 format
  publicationUrl: string;
  description: string;
}

export interface Honor {
  title: string;
  issuer: string;
  issueMonth: number; // 1-12
  issueYear: number;
  description: string;
}

export interface ResumeData {
  profile: Profile;
  workExperiences: WorkExperience[];
  educations: Education[];
  skills: string[];
  licenses: License[];
  languages: Language[];
  achievements: Achievement[];
  publications: Publication[];
  honors: Honor[];
}


