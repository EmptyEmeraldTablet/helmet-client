export type DetectionLabel =
  | "helmet"
  | "vest"
  | "person"
  | "head"
  | "no_helmet"
  | "none";

export type Detection = {
  label: DetectionLabel;
  confidence: number;
  bbox: [number, number, number, number];
};

export type UploadResult = {
  task_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  annotated_image_url: string | null;
  detections: Detection[];
  has_violation: boolean;
  process_time_ms: number | null;
};
