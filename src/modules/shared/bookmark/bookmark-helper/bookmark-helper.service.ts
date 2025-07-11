import angular from 'angular';
import { Injectable } from 'angular-ts-decorators';
import { Bookmarks as NativeBookmarks } from 'webextension-polyfill';
import { BookmarkSearchResult } from '../../../app/app-search/app-search.interface';
import { CryptoService } from '../../crypto/crypto.service';
import { BookmarkNotFoundError, HttpRequestAbortedError } from '../../errors/errors';
import Globals from '../../global-shared.constants';
import { PlatformService } from '../../global-shared.interface';
import { StoreKey } from '../../store/store.enum';
import { StoreService } from '../../store/store.service';
import { UtilityService } from '../../utility/utility.service';
import { BookmarkContainer, BookmarkType } from '../bookmark.enum';
import { Bookmark, BookmarkMetadata, BookmarkSearchQuery } from '../bookmark.interface';

@Injectable('BookmarkHelperService')
export class BookmarkHelperService {
  Strings = require('../../../../../res/strings/en.json');

  $injector: ng.auto.IInjectorService;
  $q: ng.IQService;
  cryptoSvc: CryptoService;
  _platformSvc: PlatformService | undefined;
  storeSvc: StoreService;
  utilitySvc: UtilityService;

  cachedBookmarks_encrypted: string | undefined;
  cachedBookmarks_plain: Bookmark[] | undefined;

  static $inject = ['$injector', '$q', 'CryptoService', 'StoreService', 'UtilityService'];
  constructor(
    $injector: ng.auto.IInjectorService,
    $q: ng.IQService,
    CryptoSvc: CryptoService,
    StoreSvc: StoreService,
    UtilitySvc: UtilityService
  ) {
    this.$injector = $injector;
    this.$q = $q;
    this.cryptoSvc = CryptoSvc;
    this.storeSvc = StoreSvc;
    this.utilitySvc = UtilitySvc;
  }

  get platformSvc(): PlatformService {
    if (angular.isUndefined(this._platformSvc)) {
      this._platformSvc = this.$injector.get('PlatformService');
    }
    return this._platformSvc as PlatformService;
  }

  cleanAllBookmarks(bookmarks: Bookmark[]): Bookmark[] {
    return bookmarks.map((bookmark) => {
      const cleanedBookmark = this.cleanBookmark(bookmark);
      if (angular.isArray(cleanedBookmark.children)) {
        cleanedBookmark.children = this.cleanAllBookmarks(cleanedBookmark.children);
      }
      return cleanedBookmark;
    });
  }

  cleanBookmark(bookmark: Bookmark): Bookmark {
    const validKeys = ['children', 'description', 'id', 'tags', 'title', 'url'];

    // Remove invalid and empty properties (except for children array)
    const cleanedBookmark: Bookmark = {};
    Object.keys(bookmark).forEach((key) => {
      const keyValue = Object.entries(bookmark).find(({ 0: prop }) => prop === key)?.[1];

      // Remove invalid keys
      if (!validKeys.includes(key)) {
        return;
      }

      // Remove undefined keys
      if (angular.isUndefined(keyValue ?? undefined)) {
        return;
      }

      // Remove empty description
      if (key === 'description' && (keyValue ?? '').trim() === '') {
        return;
      }

      // Remove empty tags
      if (key === 'tags' && (keyValue ?? []).length === 0) {
        return;
      }

      // Copy key value to clean bookmark
      Object.assign(cleanedBookmark, { [key]: keyValue });
    });

    return cleanedBookmark;
  }

  eachBookmark<T = Bookmark>(
    iteratee: (rootBookmark: T) => void,
    bookmarks: T[] = [],
    untilCondition?: () => boolean
  ): void {
    // Run the iteratee function for every bookmark until the condition is met
    const iterateBookmarks = (bookmarksToIterate: T[]): void => {
      for (let i = 0; i < bookmarksToIterate.length; i += 1) {
        if (untilCondition?.() === true) {
          break;
        }
        iteratee(bookmarksToIterate[i]);
        if ((bookmarksToIterate[i] as any).children?.length) {
          iterateBookmarks((bookmarksToIterate[i] as any).children);
        }
      }
    };
    iterateBookmarks(bookmarks);
  }

  extractBookmarkMetadata(bookmark: Bookmark | NativeBookmarks.BookmarkTreeNode): BookmarkMetadata {
    const metadata: BookmarkMetadata = {
      description: (bookmark as Bookmark).description,
      tags: (bookmark as Bookmark).tags,
      title: bookmark.title,
      url: bookmark.url
    };

    // Check if separator
    if (
      this.getBookmarkType(bookmark as Bookmark) === BookmarkType.Separator ||
      this.nativeBookmarkIsSeparator(bookmark as NativeBookmarks.BookmarkTreeNode)
    ) {
      metadata.url = Globals.Bookmarks.SeparatorUrl;
    }

    // Remove empty properties
    Object.keys(metadata).forEach((key) => {
      if (angular.isUndefined(metadata[key] ?? undefined)) {
        delete metadata[key];
      }
    });

    return metadata;
  }

  findBookmarkById(
    id: number | string,
    bookmarks: Bookmark[] | NativeBookmarks.BookmarkTreeNode[] = []
  ): Bookmark | NativeBookmarks.BookmarkTreeNode | undefined {
    if (angular.isUndefined(id)) {
      return;
    }

    // Recursively iterate through all bookmarks until id match is found
    let bookmark: Bookmark | NativeBookmarks.BookmarkTreeNode | undefined;
    const index = bookmarks.findIndex((x: Bookmark | NativeBookmarks.BookmarkTreeNode) => {
      return x.id === id;
    });
    if (index === -1) {
      (bookmarks as Bookmark[]).forEach((x) => {
        if (!bookmark) {
          bookmark = this.findBookmarkById(id, x.children);
        }
      });
    } else {
      bookmark = bookmarks[index];
      // Set index as bookmark indexes in Firefox are unreliable!
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1556427
      if ((bookmark as NativeBookmarks.BookmarkTreeNode).index != null) {
        (bookmark as NativeBookmarks.BookmarkTreeNode).index = index;
      }
    }

    return bookmark;
  }

  findCurrentUrlInBookmarks(): ng.IPromise<Bookmark | undefined> {
    // Check if current url is contained in bookmarks
    return this.$q.all([this.platformSvc.getCurrentUrl(), this.platformSvc.getCurrentLocale()]).then((results) => {
      const [currentUrl, currentLocale] = results;
      if (!currentUrl) {
        return;
      }
      return this.getCachedBookmarks().then((bookmarks) => {
        let targetBookmark: Bookmark | undefined;
        this.eachBookmark(
          (bookmark) => {
            if (this.utilitySvc.stringsAreEquivalent(bookmark?.url, currentUrl, currentLocale)) {
              targetBookmark = bookmark;
            }
          },
          bookmarks,
          () => !!targetBookmark
        );
        return targetBookmark;
      });
    });
  }

  getBookmarkById(id: number): ng.IPromise<Bookmark | undefined> {
    return this.getCachedBookmarks().then((bookmarks) => {
      let targetBookmark: Bookmark;
      this.eachBookmark(
        (bookmark) => {
          if (bookmark.id === id) {
            targetBookmark = bookmark;
          }
        },
        bookmarks,
        () => !!targetBookmark
      );
      return targetBookmark;
    });
  }

  getBookmarkTitleForDisplay(bookmark: Bookmark): string | undefined {
    const bookmarkType = this.getBookmarkType(bookmark);

    // If normal bookmark, return title or if blank url to display
    if (bookmarkType === BookmarkType.Bookmark) {
      return bookmark.title ? bookmark.title : bookmark.url.replace(/^https?:\/\//i, '');
    }

    if (bookmarkType === BookmarkType.Container) {
      let containerTitle: string;
      switch (bookmark.title) {
        case BookmarkContainer.Menu:
          containerTitle = this.platformSvc.getI18nString(this.Strings.Bookmarks.Container.Menu);
          break;
        case BookmarkContainer.Other:
          containerTitle = this.platformSvc.getI18nString(this.Strings.Bookmarks.Container.Other);
          break;
        case BookmarkContainer.Toolbar:
          containerTitle = this.platformSvc.getI18nString(this.Strings.Bookmarks.Container.Toolbar);
          break;
        default:
          containerTitle = `${undefined}`;
      }
      return containerTitle;
    }

    // Otherwise bookmark is a folder, return title if not a container
    return bookmark.title;
  }

  getBookmarkType(bookmark: Bookmark): BookmarkType {
    const bookmarkType = BookmarkType.Bookmark;

    // Check if container
    if (
      bookmark.title === BookmarkContainer.Menu ||
      bookmark.title === BookmarkContainer.Other ||
      bookmark.title === BookmarkContainer.Toolbar
    ) {
      return BookmarkType.Container;
    }

    // Check if folder
    if (angular.isArray(bookmark.children)) {
      return BookmarkType.Folder;
    }

    // Check if separator
    if (bookmark.url === Globals.Bookmarks.SeparatorUrl) {
      return BookmarkType.Separator;
    }

    return bookmarkType;
  }

  getCachedBookmarks(): ng.IPromise<Bookmark[] | undefined> {
    // Get cached encrypted bookmarks from store
    return this.storeSvc.get<string>(StoreKey.Bookmarks).then((encryptedBookmarksFromStore) => {
      return (
        this.$q<Bookmark[] | undefined>((resolve, reject) => {
          // Return unencrypted cached bookmarks from memory if encrypted bookmarks
          // in storage match cached encrypted bookmarks in memory
          if (
            !angular.isUndefined(encryptedBookmarksFromStore ?? undefined) &&
            !angular.isUndefined(this.cachedBookmarks_encrypted ?? undefined) &&
            !angular.isUndefined(this.cachedBookmarks_plain ?? undefined) &&
            encryptedBookmarksFromStore === this.cachedBookmarks_encrypted
          ) {
            return resolve(this.cachedBookmarks_plain);
          }

          // If encrypted bookmarks not cached in storage, retrieve synced data
          (!angular.isUndefined(encryptedBookmarksFromStore ?? undefined)
            ? this.$q.resolve(encryptedBookmarksFromStore)
            : this.utilitySvc.getApiService().then((apiSvc) =>
                apiSvc.getBookmarks().then((response) => {
                  return response.bookmarks;
                })
              )
          )
            .then((encryptedBookmarks) => {
              // Decrypt bookmarks
              return this.cryptoSvc.decryptData(encryptedBookmarks).then((bookmarksJson) => {
                // Update cache with retrieved bookmarks data
                const bookmarks: Bookmark[] = bookmarksJson ? JSON.parse(bookmarksJson) : [];
                return this.updateCachedBookmarks(bookmarks, encryptedBookmarks).then(() => {
                  resolve(bookmarks);
                });
              });
            })
            .catch(reject);
        })
          // Return a copy so as not to affect cached bookmarks in memory
          .then((bookmarks) => {
            return angular.copy(bookmarks);
          })
      );
    });
  }

  getContainer(containerName: string, bookmarks: Bookmark[], createIfNotPresent = false): Bookmark | undefined {
    // If container does not exist, create it if specified
    let container = bookmarks.find((x) => x.title === containerName);
    if (!container && createIfNotPresent) {
      container = this.newBookmark(containerName, undefined, undefined, undefined, bookmarks);
      bookmarks.push(container);
    }
    return container;
  }

  getContainerByBookmarkId(id: number, bookmarks: Bookmark[]): Bookmark | undefined {
    // Check if the id corresponds to a container
    const bookmark = this.findBookmarkById(id, bookmarks) as Bookmark;
    if (this.getBookmarkType(bookmark) === BookmarkType.Container) {
      return bookmark as Bookmark;
    }

    // Search through the child bookmarks of each container to find the bookmark
    let container: Bookmark | undefined;
    bookmarks.forEach((x) => {
      this.eachBookmark(
        (child) => {
          if (child.id === id) {
            container = x;
          }
        },
        x.children,
        () => !!container
      );
    });
    return container;
  }

  getKeywordsFromBookmark(bookmark: Bookmark, locale: string, tagsOnly = false, includeUrl = false): string[] {
    let keywords: string[] = [];
    if (!tagsOnly) {
      // Add all words in title and description
      keywords = keywords.concat(this.utilitySvc.splitTextIntoWords(bookmark.title, locale));
      keywords = keywords.concat(this.utilitySvc.splitTextIntoWords(bookmark.description, locale));

      if (includeUrl) {
        // Add url host
        try {
          const url = new URL(bookmark.url);
          const noProtocolUrl = bookmark.url.replace(new RegExp(`^${url.protocol}[/]*`), '');
          const relativeUrl = `${url.pathname}${url.search}${url.hash}`;
          if (relativeUrl !== '/') {
            keywords.push(noProtocolUrl.toLocaleLowerCase(locale).replace(/\/$/, ''));
          } else {
            keywords.push(noProtocolUrl.substring(0, noProtocolUrl.indexOf(relativeUrl)).toLocaleLowerCase(locale));
          }
        } catch {}
      }
    }

    // Add tags
    keywords = keywords.concat(this.utilitySvc.splitTextIntoWords(bookmark.tags?.join(' '), locale));

    // Remove words of two chars or less
    keywords = keywords.filter((item) => {
      return item.length > 2;
    });

    // Sort keywords and return
    return this.utilitySvc.sortWords(keywords);
  }

  getLookahead(word: string, bookmarks: Bookmark[], tagsOnly = false, exclusions: string[] = []): ng.IPromise<any> {
    if (!word) {
      return this.$q.resolve('');
    }

    let getBookmarks: ng.IPromise<Bookmark[] | undefined>;
    if ((bookmarks ?? undefined) === undefined) {
      // Get cached bookmarks
      getBookmarks = this.getCachedBookmarks();
    } else {
      // Use supplied bookmarks
      getBookmarks = this.$q.resolve(bookmarks);
    }

    // Get lookaheads
    return this.$q
      .all([getBookmarks, this.platformSvc.getCurrentLocale()])
      .then((results) => {
        const [bookmarksToSearch, currentLocale] = results;
        return this.searchBookmarksForLookaheads(word, currentLocale, tagsOnly, bookmarksToSearch);
      })
      .then((lookaheads) => {
        // Remove exclusions from lookaheads
        if (exclusions) {
          lookaheads = lookaheads.filter((x) => !exclusions.includes(x));
        }

        if (lookaheads.length === 0) {
          return;
        }

        // Count lookaheads and return most common
        const counts = lookaheads.reduce((acc, val) => {
          acc[val] = acc[val] === undefined ? 1 : (acc[val] += 1);
          return acc;
        }, {});
        const lookahead = Object.keys(counts).reduce((x, y) => {
          return counts[x] > counts[y] ? x : y;
        });

        return [lookahead, word];
      })
      .catch((err) => {
        // Swallow error if request was cancelled
        if (err instanceof HttpRequestAbortedError) {
          return;
        }

        throw err;
      });
  }

  getNativeBookmarksAsBookmarks(nativeBookmarks: NativeBookmarks.BookmarkTreeNode[] = []): Bookmark[] {
    const bookmarks: Bookmark[] = [];
    for (let i = 0; i < nativeBookmarks.length; i += 1) {
      // Check if current native bookmark is a separator
      const nativeBookmark = nativeBookmarks[i];
      const metadata = this.extractBookmarkMetadata(nativeBookmark);
      const bookmark = this.newBookmark(metadata.title, metadata.url, metadata.description, metadata.tags);

      // If this is a folder and has children, process them
      if (nativeBookmark.children?.length) {
        bookmark.children = this.getNativeBookmarksAsBookmarks(nativeBookmark.children);
      }
      bookmarks.push(bookmark);
    }
    return bookmarks;
  }

  getNewBookmarkId(bookmarks: Bookmark[], takenIds: number[] = [0]): number {
    // Check existing bookmarks for highest id
    let highestId = 0;
    this.eachBookmark((bookmark) => {
      if (!angular.isUndefined(bookmark.id ?? undefined) && parseInt(bookmark.id!.toString(), 10) > highestId) {
        highestId = parseInt(bookmark.id!.toString(), 10);
      }
    }, bookmarks);

    // Compare highest id with supplied taken ids
    const highestTakenId = takenIds.reduce((x, y) => (x > y ? x : y));
    highestId = highestTakenId > highestId ? highestTakenId : highestId;
    return highestId + 1;
  }

  nativeBookmarkIsSeparator(nativeBookmark: NativeBookmarks.BookmarkTreeNode): boolean {
    if (angular.isUndefined(nativeBookmark ?? undefined)) {
      return false;
    }
    return (
      nativeBookmark.type === BookmarkType.Separator ||
      ((nativeBookmark.title === Globals.Bookmarks.HorizontalSeparatorTitle ||
        nativeBookmark.title === Globals.Bookmarks.VerticalSeparatorTitle) &&
        nativeBookmark.url === this.platformSvc.getNewTabUrl())
    );
  }

  modifyBookmarkById(id: number, newMetadata: BookmarkMetadata, bookmarks: Bookmark[]): ng.IPromise<Bookmark[]> {
    const updatedBookmarks = angular.copy(bookmarks);
    const bookmarkToModify = this.findBookmarkById(id, updatedBookmarks) as Bookmark;
    if (!bookmarkToModify) {
      throw new BookmarkNotFoundError();
    }

    // Create a new bookmark with the new metadata
    const bookmarkFromNewMetadata = this.newBookmark(
      newMetadata.title,
      newMetadata.url,
      newMetadata.description,
      newMetadata.tags
    );

    // Copy id and children
    bookmarkFromNewMetadata.id = bookmarkToModify.id;
    if (
      this.getBookmarkType(bookmarkToModify) === BookmarkType.Folder &&
      this.getBookmarkType(bookmarkFromNewMetadata) === BookmarkType.Folder
    ) {
      bookmarkFromNewMetadata.children = bookmarkToModify.children;
    }

    // Overwrite existing bookmark and return updated bookmarks
    angular.copy(bookmarkFromNewMetadata, bookmarkToModify);
    return this.$q.resolve(updatedBookmarks);
  }

  newBookmark(
    title: string,
    url?: string,
    description?: string,
    tags?: string[],
    bookmarksToGenerateNewId?: Bookmark[]
  ): Bookmark {
    const newBookmark: Bookmark = {
      children: [],
      description: this.utilitySvc.trimToNearestWord(description, Globals.Bookmarks.DescriptionMaxLength),
      tags,
      title: title?.trim(),
      url: url?.trim()
    };

    // If bookmark has a url it is not a folder so delete children prop, otherwise delete url prop
    if (url) {
      delete newBookmark.children;
    } else {
      delete newBookmark.url;
    }

    // If the bookmark is a separator remove other properties
    if (this.getBookmarkType(newBookmark) === BookmarkType.Separator) {
      Object.keys(newBookmark).forEach((key) => {
        if (key !== 'url') {
          delete newBookmark[key];
        }
      });
    }

    // If bookmarks provided, generate new id
    if (bookmarksToGenerateNewId) {
      newBookmark.id = this.getNewBookmarkId(bookmarksToGenerateNewId);
    }

    // Clean new bookmark of empty attributes before returning
    return this.cleanBookmark(newBookmark);
  }

  removeBookmarkById(id: number, bookmarks: Bookmark[]): ng.IPromise<Bookmark[]> {
    // Iterate through bookmarks and remove the bookmark that matches the id param
    const updatedBookmarks = angular.copy(bookmarks);
    this.eachBookmark((bookmark) => {
      if (!bookmark.children) {
        return;
      }
      const indexToRemove = bookmark.children.findIndex((child) => child.id === id);
      if (indexToRemove >= 0) {
        bookmark.children.splice(indexToRemove, 1);
      }
    }, updatedBookmarks);
    return this.$q.resolve(updatedBookmarks);
  }

  removeEmptyContainers(bookmarks: Bookmark[]): Bookmark[] {
    const menuContainer = this.getContainer(BookmarkContainer.Menu, bookmarks);
    const otherContainer = this.getContainer(BookmarkContainer.Other, bookmarks);
    const toolbarContainer = this.getContainer(BookmarkContainer.Toolbar, bookmarks);
    const removeArr: Bookmark[] = [];

    if (!menuContainer?.children?.length) {
      removeArr.push(menuContainer);
    }

    if (!otherContainer?.children?.length) {
      removeArr.push(otherContainer);
    }

    if (!toolbarContainer?.children?.length) {
      removeArr.push(toolbarContainer);
    }

    return bookmarks.filter((x) => !removeArr.includes(x));
  }

  searchBookmarks(query: BookmarkSearchQuery): ng.IPromise<Bookmark[]> {
    if (!query) {
      query = { keywords: [] };
    }
    return this.$q.all([this.getCachedBookmarks(), this.platformSvc.getCurrentLocale()]).then((response) => {
      const [bookmarks, currentLocale] = response;
      let results: BookmarkSearchResult[];

      // If url supplied, first search by url
      if (query.url) {
        results = this.searchBookmarksByUrl(bookmarks, query.url, currentLocale) ?? [];
      }

      // Search by keywords and sort (score desc, id desc) using results from url search if relevant
      results = this.searchBookmarksByKeywords(
        results ?? (bookmarks as BookmarkSearchResult[]),
        currentLocale,
        query.keywords
      );
      return results
        .sort((x, y) => {
          return x.id - y.id;
        })
        .sort((x, y) => {
          return x.score - y.score;
        })
        .reverse();
    });
  }

  searchBookmarksByKeywords(
    bookmarks: Bookmark[],
    locale: string,
    keywords: string[] = [],
    results: BookmarkSearchResult[] = []
  ): BookmarkSearchResult[] {
    bookmarks.forEach((bookmark) => {
      const bookmarkType = this.getBookmarkType(bookmark);

      // Ignore separators
      if (bookmarkType === BookmarkType.Separator) {
        return;
      }

      // If bookmark is a container or folder, search children
      if (bookmarkType === BookmarkType.Container || bookmarkType === BookmarkType.Folder) {
        if (bookmark.children?.length) {
          this.searchBookmarksByKeywords(bookmark.children, locale, keywords, results);
        }
      } else {
        // Get match scores for each keyword against bookmark words
        const bookmarkWords = this.getKeywordsFromBookmark(bookmark, locale, false, true);
        const scores = keywords.map((keyword) => {
          let count = 0;
          bookmarkWords.forEach((word) => {
            if (word?.toLocaleLowerCase(locale).indexOf(keyword.toLocaleLowerCase(locale)) >= 0) {
              count += 1;
            }
          });

          return count;
        });

        // Check all keywords match
        if (angular.isUndefined(scores.find((x) => x === 0))) {
          // Calculate score
          const score = scores.reduce((memo, num) => memo + num, 0);

          // Add result
          const result: BookmarkSearchResult = angular.copy(bookmark);
          result.score = score;
          results.push(result);
        }
      }
    });

    return results;
  }

  searchBookmarksByUrl(
    bookmarks: Bookmark[],
    url: string,
    locale: string,
    results: BookmarkSearchResult[] = []
  ): BookmarkSearchResult[] {
    results = results.concat(
      bookmarks.filter((bookmark) => {
        // Consider only actual bookmarks
        const bookmarkType = this.getBookmarkType(bookmark);
        if (bookmarkType !== BookmarkType.Bookmark) {
          return false;
        }

        // Check if the bookmark url contains the url param
        return bookmark.url.toLocaleLowerCase(locale).indexOf(url.toLocaleLowerCase(locale)) >= 0;
      })
    );

    for (let i = 0; i < bookmarks.length; i += 1) {
      if (bookmarks[i].children?.length) {
        results = this.searchBookmarksByUrl(bookmarks[i].children, url, locale, results);
      }
    }

    return results;
  }

  searchBookmarksForLookaheads(
    word: string,
    locale: string,
    tagsOnly = false,
    bookmarks: Bookmark[] = [],
    results: string[] = []
  ): string[] {
    bookmarks.forEach((bookmark) => {
      const bookmarkType = this.getBookmarkType(bookmark);

      // Ignore separators
      if (bookmarkType === BookmarkType.Separator) {
        return;
      }

      // If bookmark is a container or folder, search children
      if (bookmarkType === BookmarkType.Container || bookmarkType === BookmarkType.Folder) {
        results = this.searchBookmarksForLookaheads(word, locale, tagsOnly, bookmark.children, results);
      } else {
        // Find all words that begin with lookahead word
        const bookmarkWords = this.getKeywordsFromBookmark(bookmark, locale, tagsOnly, true);
        results = results.concat(
          bookmarkWords.filter((innerbookmark) => {
            return innerbookmark.indexOf(word) === 0;
          })
        );
      }
    });

    return results;
  }

  updateCachedBookmarks(bookmarks: Bookmark[], encryptedBookmarks: string): ng.IPromise<void> {
    return this.$q<void>((resolve) => {
      if (angular.isUndefined(encryptedBookmarks ?? undefined)) {
        return resolve();
      }

      // Update storage cache with new encrypted bookmarks
      return this.storeSvc.set(StoreKey.Bookmarks, encryptedBookmarks).then(() => {
        // Update memory cached bookmarks
        this.cachedBookmarks_encrypted = angular.copy(encryptedBookmarks);
        if (bookmarks !== undefined) {
          this.cachedBookmarks_plain = angular.copy(bookmarks);
        }
        resolve();
      });
    });
  }
}
