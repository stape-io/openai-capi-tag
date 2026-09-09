const computeEffectiveTldPlusOne = require('computeEffectiveTldPlusOne');
const createRegex = require('createRegex');
const encodeUriComponent = require('encodeUriComponent');
const generateRandom = require('generateRandom');
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
    httpOnly: !!data.cookieHttpOnly
  };

  if (data.setClickIdCookie && mappedData.events[0].oppref) {
    cookieOptions['max-age'] = 60 * 60 * 24 * makeInteger(data.cookieExpiration || 30);
    setCookie('__oppref', mappedData.events[0].oppref, cookieOptions, false);
  }

  if (data.setBrowserIdCookie && mappedData.events[0].user.obref) {
    cookieOptions['max-age'] = 60 * 60 * 24 * makeInteger(data.cookieExpirationBrowserId || 365);
    setCookie('__obref', mappedData.events[0].user.obref, cookieOptions, false);
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

  return toValueList(email);
}

function getPhoneNumbersFromEventData(eventData) {
  const eventDataUserData = eventData.user_data || {};
  return toValueList(eventData.phone_number || eventDataUserData.phone_number);
}

function getAddressListFromEventData(eventData) {
  const eventDataUserData = eventData.user_data || {};
  const addressType = getType(eventDataUserData.address);

  if (addressType === 'array') return eventDataUserData.address.filter((a) => getType(a) === 'object');
  if (addressType === 'object') return [eventDataUserData.address];

  return [];
}

function getFieldListFromAddresses(addresses, fieldName) {
  return addresses.map((address) => address[fieldName]).filter((v) => getType(v) === 'string' && v !== '');
}

function getAndroidAdvertisingIdFromEventData(eventData) {
  const platform = eventData['x-ga-platform'];
  const aaid = platform === 'android' ? eventData['x-ga-resettable_device_id'] : undefined;

  if (getType(aaid) === 'string' && aaid !== '00000000-0000-0000-0000-000000000000') return aaid;

  return undefined;
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

function getBrowserId(data, eventData) {
  const browserId =
    getCookieValues('__obref')[0] ||
    (eventData.common_cookie || {})['__obref'] ||
    eventData.__obref ||
    eventData.obref;

  if (browserId) return browserId;

  if (data.setBrowserIdCookie) return generateUUID();
}

function addUserData(data, eventData, event) {
  const values = {};

  if (isUIFieldTrue(data.autoMapUserDataParameters)) {
    values.email_sha256 = getEmailAddressFromEventData(eventData);
    values.external_id_sha256 = toValueList(eventData.user_id);
    values.phone_number_sha256 = getPhoneNumbersFromEventData(eventData);

    const addresses = getAddressListFromEventData(eventData);
    values.first_name_sha256 = getFieldListFromAddresses(addresses, 'first_name');
    values.last_name_sha256 = getFieldListFromAddresses(addresses, 'last_name');
    values.city = getFieldListFromAddresses(addresses, 'city');
    values.zip_code = getFieldListFromAddresses(addresses, 'postal_code');
    values.region = getFieldListFromAddresses(addresses, 'region');
    values.country = getFieldListFromAddresses(addresses, 'country');

    if (eventData.ip_override) values.ip_address = eventData.ip_override;

    if (eventData.user_agent) values.user_agent = eventData.user_agent;

    const androidAdvertisingId = getAndroidAdvertisingIdFromEventData(eventData);
    if (androidAdvertisingId) values.android_advertising_id = androidAdvertisingId;

    const browserId = getBrowserId(data, eventData);
    if (browserId) values.obref = browserId;
  }

  if (data.userDataParametersList) {
    const listUserDataFields = [
      'email_sha256',
      'phone_number_sha256',
      'external_id_sha256',
      'first_name_sha256',
      'last_name_sha256',
      'city',
      'zip_code',
      'region',
      'country'
    ];

    data.userDataParametersList.forEach((d) => {
      let name = d.name;
      if (['city_sha256', 'zip_code_sha256', 'country_sha256'].indexOf(name) !== -1) {
        // Backward compatibility after OpenAI removed the _sha256 requirement for geographic fields.
        name = name.replace('_sha256', '');
      } else if (name === 'external_id') {
        // Backward compatibility after OpenAI removed the plain external_id field.
        name = 'external_id_sha256';
      }

      values[name] = listUserDataFields.indexOf(name) !== -1 ? toValueList(d.value) : d.value;
    });
  }

  event.user = buildUserData(values);

  return event;
}

function buildUserData(values) {
  const userData = {};

  const hashedListFields = {
    email_sha256: 'emails_sha256',
    phone_number_sha256: 'phone_numbers_sha256',
    external_id_sha256: 'external_ids_sha256',
    first_name_sha256: 'first_names_sha256',
    last_name_sha256: 'last_names_sha256'
  };

  Object.keys(hashedListFields).forEach((key) => {
    const list = values[key];
    if (getType(list) === 'array' && list.length) userData[hashedListFields[key]] = list;
  });

  const plainListFields = {
    city: 'cities',
    zip_code: 'postal_codes',
    region: 'regions',
    country: 'countries'
  };

  Object.keys(plainListFields).forEach((key) => {
    const list = values[key];
    if (getType(list) === 'array' && list.length) userData[plainListFields[key]] = list;
  });

  ['ip_address', 'user_agent', 'obref', 'android_advertising_id'].forEach((key) => {
    if (values[key]) userData[key] = values[key];
  });

  return userData;
}

function getEventParametersType(eventName) {
  const eventParametersTypeMap = {
    custom: 'custom',
    checkout_started: 'contents',
    contents_viewed: 'contents',
    items_added: 'contents',
    order_created: 'contents',
    page_viewed: 'contents',
    app_installed: 'customer_action',
    app_opened: 'customer_action',
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
        if (i.item_group_id) item.group_id = makeString(i.item_group_id);
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

  if (data.eventCustomParametersList) {
    data.eventCustomParametersList.forEach((d) => {
      eventParameters[d.name] = d.value;
    });
  }

  event.data = eventParameters;

  return event;
}

function hashDataIfNeeded(event) {
  const userData = event.user;
  const hasUserData = hasProps(userData);

  if (hasUserData) {
    const userDataKeysToNormalize = {
      emails_sha256: normalizeEmail,
      phone_numbers_sha256: normalizePhone,
      external_ids_sha256: trim,
      first_names_sha256: normalizeName,
      last_names_sha256: normalizeName
    };

    Object.keys(userDataKeysToNormalize).forEach((key) => {
      const value = userData[key];
      if (!value) return;
      userData[key] = hashData(value, userDataKeysToNormalize[key]);
    });
  }

  return event;
}

function getEventNameInfo(data, eventData) {
  const STANDARD_EVENT_NAMES = [
    'page_viewed',
    'app_installed',
    'app_opened',
    'appointment_scheduled',
    'checkout_started',
    'contents_viewed',
    'items_added',
    'lead_created',
    'order_created',
    'registration_completed',
    'subscription_created',
    'trial_started'
  ];

  const toEventNameInfo = (eventName) => {
    return STANDARD_EVENT_NAMES.indexOf(eventName) !== -1
      ? { eventName: eventName }
      : { eventName: 'custom', customEventName: eventName };
  };

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

    return toEventNameInfo(gaToEventName[eventName] || eventName);
  }

  return toEventNameInfo(
    data.eventNameSetup === 'standard' ? data.eventNameStandard : data.eventNameCustom
  );
}

function mapEvent(data, eventData) {
  const event = {};
  const mappedData = {
    integration_source: 'stape-sgtm',
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

  if (!event.type || (event.type === 'custom' && !event.custom_event_name))
    return 'Event Name is required.';

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

function random() {
  return generateRandom(1000000000000000, 10000000000000000) / 10000000000000000;
}

function generateUUID() {
  function s(n) {
    return h((random() * (1 << (n << 2))) ^ getTimestampMillis()).slice(-n);
  }
  function h(n) {
    return (n | 0).toString(16);
  }
  return [
    s(4) + s(4),
    s(4),
    '4' + s(3),
    h(8 | (random() * 4)) + s(3),
    getTimestampMillis().toString(16).slice(-10) + s(2)
  ].join('-');
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

function hashData(value, normalize) {
  if (!value) return value;

  const type = getType(value);

  if (value === 'undefined' || value === 'null') return undefined;

  if (type === 'array') {
    return value.map((val) => hashData(val, normalize));
  }

  if (type === 'object') {
    return Object.keys(value).reduce((acc, val) => {
      acc[val] = hashData(value[val], normalize);
      return acc;
    }, {});
  }

  if (isHashed(value)) return value;

  const normalizeFn = normalize || normalizeEmail;
  return sha256Sync(normalizeFn(makeString(value)), {
    outputEncoding: 'hex'
  });
}

function trim(value) {
  return makeString(value).trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

function normalizePhone(value) {
  const phoneStripRegex = createRegex('[^0-9]', 'g');
  let phone = makeString(value);
  if (phoneStripRegex) phone = phone.replace(phoneStripRegex, '');
  if (phone.charAt(0) === '+') phone = phone.substring(1);
  while (phone.length && phone.charAt(0) === '0') phone = phone.substring(1);
  return phone;
}

function normalizeName(value) {
  // ASCII whitespace and punctuation to strip; non-ASCII characters are preserved.
  const charsToStrip = [
    ' ', '\t', '\n', '\r',
    '!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/',
    ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`', '{', '|', '}', '~'
  ];
  let name = makeString(value).toLowerCase();
  charsToStrip.forEach((char) => {
    name = name.split(char).join('');
  });
  return name;
}

function toValueList(value) {
  const type = getType(value);

  if (type === 'array') return value.filter((v) => getType(v) === 'string' && v !== '');
  if (type === 'string' && value !== '') return [value];
  if (type === 'number') return [makeString(value)];

  return [];
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
