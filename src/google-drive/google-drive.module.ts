import { GoogleDriveService } from './google-drive.service';
import { GoogleDriveController } from './google-drive.controller';
import { Module } from '@nestjs/common';

@Module({
    controllers: [GoogleDriveController],
    providers: [GoogleDriveService],
    exports: [GoogleDriveService],
})
export class GoogleDriveModule { }
