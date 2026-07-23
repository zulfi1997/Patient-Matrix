export interface GraphAppOnlyCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sharedFolderUrl: string;
}

export interface UploadToOneDriveFolderOptions extends GraphAppOnlyCredentials {
  subfolderName: string;
  fileName: string;
  buffer: Buffer;
}

export function uploadToOneDriveFolder(options: UploadToOneDriveFolderOptions): Promise<unknown>;

export interface OneDriveFileListing {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
}

export interface ListOneDriveFolderOptions extends GraphAppOnlyCredentials {
  subfolderName: string;
}

export function listOneDriveFolder(options: ListOneDriveFolderOptions): Promise<OneDriveFileListing[]>;

export interface DownloadedOneDriveFile {
  name: string;
  lastModifiedDateTime: string;
  buffer: Buffer;
}

export function downloadLatestFromOneDriveFolder(options: ListOneDriveFolderOptions): Promise<DownloadedOneDriveFile | null>;
