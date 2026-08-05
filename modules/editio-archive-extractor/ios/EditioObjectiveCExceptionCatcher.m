#import "EditioObjectiveCExceptionCatcher.h"

NSError * _Nullable EditioExecuteAndCaptureObjectiveCException(NS_NOESCAPE void (^block)(void)) {
  @try {
    block();
    return nil;
  } @catch (NSException *exception) {
    NSMutableDictionary *details = [NSMutableDictionary dictionary];
    details[NSLocalizedDescriptionKey] = exception.reason ?: @"Native archive extraction failed.";
    details[@"exceptionName"] = exception.name;
    return [NSError errorWithDomain:@"com.editio.archive.exception"
                               code:1
                           userInfo:details];
  }
}
