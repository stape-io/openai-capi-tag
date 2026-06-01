const computeEffectiveTldPlusOne = require('computeEffectiveTldPlusOne');
const createRegex = require('createRegex');
const encodeUriComponent = require('encodeUriComponent');
const getAllEventData = require('getAllEventData');
const getCookieValues = require('getCookieValues');
const getEventData = require('getEventData');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
const makeNumber = require('makeNumber');
const makeString = require('makeString');
const Math = require('Math');
const Object = require('Object');
const parseUrl = require('parseUrl');
const sendHttpRequest = require('sendHttpRequest');
const setCookie = require('setCookie');
const sha256Sync = require('sha256Sync');

/*==============================================================================
==============================================================================*/

const eventData = getAllEventData();

if (shouldExitEarly(data, eventData)) return;

const API_VERSION = 'v1';
const mappedData = mapEvent(data, eventData);
setCookies(data, mappedData);

const invalidOrMissingFields = validateMappedData(data, mappedData);
if (invalidOrMissingFields) {
  log({
    Name: 'OpenAIEventsAPITag',
    Type: 'Message',
    EventName: mappedData.events[0].type,
    Message: '🛑 [ERROR] Request was not sent.',
    Reason: invalidOrMissingFields
  });

  return data.gtmOnFailure();
}

sendRequest(data, mappedData);

if (data.useOptimisticScenario) {
  return data.gtmOnSuccess();
}

/*==============================================================================
  Vendor related functions
==============================================================================*/

function setCookies(data, mappedData) {
  const cookieOptions = {
    domain: getCookieDomain(data.cookieDomain),
    samesite: data.cookieSameSite || 'Lax',
    path: '/',
    secure: true,
    httpOnly: !!data.cookieHttpOnly,
    'max-age': 60 * 60 * 24 * makeInteger(data.cookieExpiration || 30)
  };

  if (data.setClickIdCookie && mappedData.events[0].oppref) {
    setCookie('__oppref', mappedData.events[0].oppref, cookieOptions, false);
  }
}

function addServerEventData(data, eventData, event) {
  const eventNameInfo = getEventNameInfo(data, eventData);
  const eventName = eventNameInfo.eventName;
  event.type = eventNameInfo.eventName;
  if (eventName === 'custom') event.custom_event_name = eventNameInfo.customEventName;

  event.action_source = data.actionSource;
  event.opt_out = data.optOut === true || data.optOut === false ? data.optOut : undefined;

  if (data.autoMapServerEventDataParameters) {
    event.timestamp_ms = getTimestampMillis();

    if (eventData.page_location) event.source_url = eventData.page_location;

    const eventId = eventData.event_id || eventData.eventId;
    if (eventId) event.id = makeString(eventId);

    const clickId = getClickId(eventData, 'oppref');
    if (clickId) event.oppref = clickId;
  }

  if (data.serverEventDataParametersList) {
    data.serverEventDataParametersList.forEach((d) => (event[d.name] = d.value));
  }

  return event;
}

function getEmailAddressFromEventData(eventData) {
  const eventDataUserData = eventData.user_data || {};
  const email =
    eventData.email ||
    eventData.email_address ||
    eventDataUserData.email ||
    eventDataUserData.email_address ||
    eventDataUserData.sha256_email_address;
  const emailType = getType(email);

  if (emailType === 'string') return email;
  else if (emailType === 'array' || emailType === 'object') return email[0];

  return;
}

function getPhoneNumberFromEventData(eventData) {
  const eventDataUserData = eventData.user_data || {};

  const phone =
    eventData.phone ||
    eventData.phone_number ||
    eventDataUserData.phone ||
    eventDataUserData.phone_number ||
    eventDataUserData.sha256_phone ||
    eventDataUserData.sha256_phone_number;

  const phoneType = getType(phone);

  if (phoneType === 'string') return phone;
  else if (phoneType === 'array' || phoneType === 'object') return phone[0];

  return;
}

function getAddressFromEventData(eventData) {
  const eventDataUserData = eventData.user_data || {};

  let eventDataUserDataAddress = {};
  const addressType = getType(eventDataUserData.address);
  if (addressType === 'object' || addressType === 'array') {
    eventDataUserDataAddress = eventDataUserData.address[0] || eventDataUserData.address;
  }

  return {
    city: eventDataUserDataAddress.city,
    postalCode: eventDataUserDataAddress.postal_code,
    country: eventDataUserDataAddress.country
  };
}

function parseClickIdFromUrl(eventData, clickIdName) {
  const url = eventData.page_location || eventData.page_referrer || getRequestHeader('referer');
  if (!url) return;

  const urlSearchParams = parseUrl(url).searchParams;
  return urlSearchParams[clickIdName];
}

function getClickId(eventData, clickIdName) {
  const clickIdNameWithPrefix = '__' + clickIdName;
  const clickIdFromUrl = parseClickIdFromUrl(eventData, clickIdName);
  const clickId =
    clickIdFromUrl ||
    getCookieValues(clickIdNameWithPrefix)[0] ||
    (eventData.common_cookie || {})[clickIdNameWithPrefix] ||
    eventData[clickIdNameWithPrefix] ||
    eventData[clickIdName];

  if (clickId) return clickId;
}

function addUserData(data, eventData, event) {
  const userData = {};

  if (isUIFieldTrue(data.autoMapUserDataParameters)) {
    const email = getEmailAddressFromEventData(eventData);
    if (email) userData.email_sha256 = email;

    const phone = getPhoneNumberFromEventData(eventData);
    if (phone) userData.phone_number_sha256 = phone;

    const externalId = eventData.user_id;
    if (externalId) {
      userData[isHashed(externalId) ? 'external_id_sha256' : 'external_id'] =
        makeString(externalId);
    }

    const address = getAddressFromEventData(eventData);
    if (address.city) userData.city_sha256 = address.city;
    if (address.postalCode) userData.zip_code_sha256 = address.postalCode;
    if (address.country) userData.country_sha256 = address.country;

    if (eventData.ip_override) userData.ip_address = eventData.ip_override;

    if (eventData.user_agent) userData.user_agent = eventData.user_agent;
  }

  if (data.userDataParametersList) {
    data.userDataParametersList.forEach((d) => (userData[d.name] = d.value));
  }

  event.user = userData;

  return event;
}

function getEventParametersType(eventName) {
  const eventParametersTypeMap = {
    custom: 'custom',
    checkout_started: 'contents',
    contents_viewed: 'contents',
    items_added: 'contents',
    order_created: 'contents',
    page_viewed: 'contents',
    appointment_scheduled: 'customer_action',
    lead_created: 'customer_action',
    registration_completed: 'customer_action',
    subscription_created: 'plan_enrollment',
    trial_started: 'plan_enrollment'
  };

  return eventParametersTypeMap[eventName];
}

function addEventParameters(data, eventData, event) {
  const eventParameters = {
    type: getEventParametersType(event.type)
  };

  if (isUIFieldTrue(data.autoMapEventParameters)) {
    let valueFromItems;
    let items;
    let currency = eventData.currency;

    if (getType(eventData.items) === 'array' && eventData.items.length) items = eventData.items;
    else if (
      getType(eventData.ecommerce) === 'object' &&
      getType(eventData.ecommerce.items) === 'array' &&
      eventData.ecommerce.items.length
    ) {
      items = eventData.ecommerce.items;
    }

    if (getType(items) === 'array' && items.length) {
      eventParameters.contents = [];
      valueFromItems = 0;
      if (!currency && items[0].currency) currency = items[0].currency;
      const itemIdKey = data.itemIdKey ? data.itemIdKey : 'item_id';
      items.forEach((i) => {
        const item = {};
        if (i[itemIdKey]) item.id = makeString(i[itemIdKey]);
        if (i.item_name) item.name = makeString(i.item_name);
        if (isValidValue(i.quantity)) item.quantity = makeInteger(i.quantity);
        if (isValidValue(i.price)) {
          // It considers the value from eventData is in regular unit.
          item.amount = convertCurrencyValueToMinorUnit(i.price, currency);
          if (isValidValue(item.amount)) {
            valueFromItems += (item.quantity || 1) * item.amount;
          }
        }
        item.content_type = i.content_type ? makeString(i.content_type) : 'product';
        eventParameters.contents.push(item);
      });
    }

    if (currency) eventParameters.currency = currency;

    if (isValidValue(eventData.value)) {
      // It considers the value from eventData is in regular unit.
      eventParameters.amount = convertCurrencyValueToMinorUnit(
        eventData.value,
        eventParameters.currency
      );
    } else if (isValidValue(valueFromItems)) {
      // Already converted to minor unit.
      eventParameters.amount = valueFromItems;
    }
  }

  if (data.eventParametersList) {
    let amountIsRegularUnit = false;
    let amountMinorSetByList = false;
    data.eventParametersList.forEach((d) => {
      let name = d.name;
      if (name === 'amount_regular_unit') {
        if (amountMinorSetByList) return;
        amountIsRegularUnit = true;
        name = 'amount';
      } else if (name === 'amount') {
        amountIsRegularUnit = false;
        amountMinorSetByList = true;
      }
      eventParameters[name] = d.value;
    });

    if (amountIsRegularUnit && isValidValue(eventParameters.amount)) {
      eventParameters.amount = convertCurrencyValueToMinorUnit(
        eventParameters.amount,
        eventParameters.currency
      );
    }
  }

  event.data = eventParameters;

  return event;
}

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return phoneNumber;

  const nonDigitsRegex = createRegex('[^0-9]', 'g');
  phoneNumber = makeString(phoneNumber).trim();
  phoneNumber = phoneNumber.replace(nonDigitsRegex, '');

  if (!phoneNumber) return phoneNumber;

  return '+' + phoneNumber;
}

function hashDataIfNeeded(event) {
  const userData = event.user;
  const hasUserData = hasProps(userData);

  if (hasUserData) {
    const userDataKeysToHash = {
      email_sha256: true,
      phone_number_sha256: true,
      external_id_sha256: true,
      city_sha256: true,
      zip_code_sha256: true,
      country_sha256: true
    };

    const userDataKeysNormalizer = {
      phone_number_sha256: normalizePhoneNumber
    };

    Object.keys(userDataKeysToHash).forEach((key) => {
      let value = userData[key];
      if (!value || isHashed(value)) return;
      if (userDataKeysNormalizer[key]) value = userDataKeysNormalizer[key](value);
      userData[key] = hashData(value);
    });
  }

  return event;
}

function getEventNameInfo(data, eventData) {
  if (data.eventNameSetup === 'inherit') {
    const eventName = eventData.event_name;
    const gaToEventName = {
      page_view: 'page_viewed',
      add_to_cart: 'items_added',
      sign_up: 'registration_completed',
      begin_checkout: 'checkout_started',
      generate_lead: 'lead_created',
      purchase: 'order_created',
      view_item: 'contents_viewed'
    };

    if (gaToEventName[eventName]) {
      return { eventName: gaToEventName[eventName] };
    }
    return { eventName: 'custom', customEventName: eventName };
  }

  return data.eventNameSetup === 'standard'
    ? { eventName: data.eventNameStandard }
    : { eventName: 'custom', customEventName: data.eventNameCustom };
}

function mapEvent(data, eventData) {
  const event = {};
  const mappedData = {
    validate_only: isUIFieldTrue(data.validateOnly),
    events: [event]
  };

  addServerEventData(data, eventData, event);
  addUserData(data, eventData, event);
  addEventParameters(data, eventData, event);
  hashDataIfNeeded(event);

  return mappedData;
}

function validateMappedData(data, mappedData) {
  const event = mappedData.events[0];

  if (!data.pixelId) return 'Pixel ID is required.';

  if (!event.id) return 'Event ID is required.';

  if (!event.action_source) return 'Action Source is required.';

  if (event.action_source === 'web' && !event.source_url)
    return 'Source URL is required when Action Source is web.';

  if (!event.timestamp_ms) return 'Timestamp is required.';

  if (
    getType(event.data.contents) === 'array' &&
    event.data.contents.some((i) => getType(i.content_type) !== 'string')
  )
    return 'Each item in contents must have content_type defined as a string.';

  if (isValidValue(event.data.amount) && !event.data.currency)
    return 'Currency must be set when Amount is set.';

  if (
    getType(event.data.contents) === 'array' &&
    event.data.contents.some(
      (i) => isValidValue(i.amount) && !event.data.currency && !isValidValue(i.currency)
    )
  )
    return 'Currency must be set at event level or on each item when item Amount is set.';
}

function generateRequestBaseUrl(pixelId) {
  return 'https://bzr.openai.com/' + API_VERSION + '/events?pid=' + encodeUriComponent(pixelId);
}

function generateRequestOptions(data) {
  const options = {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + data.apiKey,
      'Content-Type': 'application/json'
    }
  };

  return options;
}

function sendRequest(data, mappedData) {
  const pixelId = makeString(data.pixelId).trim();
  const requestUrl = generateRequestBaseUrl(pixelId);
  const requestOptions = generateRequestOptions(data);

  return sendHttpRequest(requestUrl, requestOptions, JSON.stringify(mappedData))
    .then((result) => {
      if (!data.useOptimisticScenario) {
        return result.statusCode >= 200 && result.statusCode < 300
          ? data.gtmOnSuccess()
          : data.gtmOnFailure();
      }
    })
    .catch((result) => {
      if (!data.useOptimisticScenario) return data.gtmOnFailure();
    });
}

/*==============================================================================
  Helpers
==============================================================================*/

function getUrl(eventData) {
  return eventData.page_location || getRequestHeader('referer') || eventData.page_referrer;
}

function shouldExitEarly(data, eventData) {
  if (!isConsentGivenOrNotRequired(data, eventData)) {
    data.gtmOnSuccess();
    return true;
  }

  const url = getUrl(eventData);
  if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
    data.gtmOnSuccess();
    return true;
  }

  return false;
}

function getCookieDomain(defaultCookieDomain) {
  return !defaultCookieDomain || defaultCookieDomain === 'auto'
    ? computeEffectiveTldPlusOne(getEventData('page_location') || getRequestHeader('referer')) ||
        'auto'
    : defaultCookieDomain;
}

function isUIFieldTrue(field) {
  return [true, 'true'].indexOf(field) !== -1;
}

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '' && value === value;
}

function roundValue(value) {
  if (!value) return value;
  return Math.round(makeNumber(value) * 100) / 100;
}

function convertCurrencyValueToMinorUnit(value, currency) {
  if (!value) return value;

  // prettier-ignore
  const zeroDecimalCurrencies = [
    'BIF', 'CLP', 'DJF', 'GNF', 'IDR', 'ISK',
    'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
    'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
  ];
  const threeDecimalCurrencies = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
  const upperCurrency = currency ? makeString(currency).toUpperCase() : '';

  let multiplier = 100; // default: 2 decimal places (BRL, USD, EUR, GBP, etc.)
  if (zeroDecimalCurrencies.indexOf(upperCurrency) !== -1) multiplier = 1;
  else if (threeDecimalCurrencies.indexOf(upperCurrency) !== -1) multiplier = 1000;

  return makeInteger(roundValue(value * multiplier));
}

function hasProps(obj) {
  return getType(obj) === 'object' && Object.keys(obj).length > 0;
}

function isHashed(value) {
  if (!value) return false;
  return makeString(value).match('^[A-Fa-f0-9]{64}$') !== null;
}

function hashData(value) {
  if (!value) return value;

  const type = getType(value);

  if (value === 'undefined' || value === 'null') return undefined;

  if (type === 'array') {
    return value.map((val) => hashData(val));
  }

  if (type === 'object') {
    return Object.keys(value).reduce((acc, val) => {
      acc[val] = hashData(value[val]);
      return acc;
    }, {});
  }

  if (isHashed(value)) return value;

  return sha256Sync(makeString(value).trim().toLowerCase(), {
    outputEncoding: 'hex'
  });
}

function isConsentGivenOrNotRequired(data, eventData) {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
  return xGaGcs[2] === '1';
}

function log(rawDataToLog) {
  rawDataToLog.TraceId = getRequestHeader('trace-id');
  logToConsole(JSON.stringify(rawDataToLog));
}
