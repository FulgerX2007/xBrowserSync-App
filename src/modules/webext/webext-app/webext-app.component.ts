import angular from 'angular';
import { Component, OnInit } from 'angular-ts-decorators';
import { boundMethod } from 'autobind-decorator';
import { AppMainComponent } from '../../app/app-main/app-main.component';
import { AppHelperService } from '../../app/shared/app-helper/app-helper.service';
import { AlertService } from '../../shared/alert/alert.service';
import { BookmarkHelperService } from '../../shared/bookmark/bookmark-helper/bookmark-helper.service';
import { PlatformService } from '../../shared/global-shared.interface';
import { LogService } from '../../shared/log/log.service';
import { NetworkService } from '../../shared/network/network.service';
import { SettingsService } from '../../shared/settings/settings.service';
import { StoreService } from '../../shared/store/store.service';
import { SyncType } from '../../shared/sync/sync.enum';
import { Sync } from '../../shared/sync/sync.interface';
import { UtilityService } from '../../shared/utility/utility.service';
import { WorkingContext } from '../../shared/working/working.enum';
import { WorkingService } from '../../shared/working/working.service';
import { WebExtPlatformService } from '../shared/webext-platform/webext-platform.service';

@Component({
  controllerAs: 'vm',
  selector: 'app',
  styles: [require('./webext-app.component.scss')],
  template: require('../../app/app-main/app-main.component.html')
})
export class WebExtAppComponent extends AppMainComponent implements OnInit {
  platformSvc: WebExtPlatformService;

  static $inject = [
    '$location',
    '$q',
    '$scope',
    '$timeout',
    'AlertService',
    'AppHelperService',
    'BookmarkHelperService',
    'LogService',
    'NetworkService',
    'PlatformService',
    'SettingsService',
    'StoreService',
    'UtilityService',
    'WorkingService'
  ];

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(
    $location: ng.ILocationService,
    $q: ng.IQService,
    $scope: ng.IScope,
    $timeout: ng.ITimeoutService,
    AlertSvc: AlertService,
    AppHelperSvc: AppHelperService,
    BookmarkHelperSvc: BookmarkHelperService,
    LogSvc: LogService,
    NetworkSvc: NetworkService,
    PlatformSvc: PlatformService,
    SettingsSvc: SettingsService,
    StoreSvc: StoreService,
    UtilitySvc: UtilityService,
    WorkingSvc: WorkingService
  ) {
    // Required for AngularJS dependency injection
    super(
      $location,
      $q,
      $scope,
      $timeout,
      AlertSvc,
      AppHelperSvc,
      BookmarkHelperSvc,
      LogSvc,
      NetworkSvc,
      PlatformSvc,
      SettingsSvc,
      StoreSvc,
      UtilitySvc,
      WorkingSvc
    );
  }

  copyTextToClipboard(text: string): ng.IPromise<void> {
    return navigator.clipboard.writeText(text);
  }

  ngOnInit(): ng.IPromise<void> {
    return (
      super
        .ngOnInit()
        // Check if a sync is currently in progress
        .then(() => this.appHelperSvc.getCurrentSync())
        .then((currentSync) => {
          if (!currentSync) {
            return;
          }

          // Display working panel
          this.logSvc.logInfo('Waiting for syncs to finish...');
          this.workingSvc.show(WorkingContext.WaitingForSyncsToFinish);
          return this.waitForSyncsToFinish()
            .then(() => {
              // Sync was a success if sync is still enabled
              return this.utilitySvc.isSyncEnabled().then((syncEnabled) => {
                if (syncEnabled) {
                  this.logSvc.logInfo('Syncs finished, resuming');
                  return this.appHelperSvc.syncBookmarksSuccess();
                }
              });
            })
            .finally(() => this.workingSvc.hide());
        })
    );
  }

  waitForSyncsToFinish(): ng.IPromise<void> {
    const condition = (currentSync: Sync): ng.IPromise<boolean> => {
      return this.$q.resolve(!angular.isUndefined(currentSync ?? undefined));
    };

    const action = (): ng.IPromise<Sync> => {
      return this.$q((resolve, reject) => {
        this.$timeout(() => {
          this.appHelperSvc.getCurrentSync().then(resolve).catch(reject);
        }, 1e3);
      });
    };

    // Periodically check sync queue until it is empty
    return this.utilitySvc.asyncWhile<Sync>({} as any, condition, action).then(() => {});
  }

  @boundMethod
  workingCancelAction(): ng.IPromise<void> {
    this.logSvc.logInfo('Cancelling sync');
    return this.platformSvc
      .queueSync({
        type: SyncType.Cancel
      })
      .then(() => {});
  }
}
