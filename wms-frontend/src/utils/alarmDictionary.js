const alarmDictionary = {
  301: {
    message: "SERVER_DISCONNECT",
    cause: "CV01 OP1 EMERGENCY ACTIVATED",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  302: {
    message: "EMG_PRESSED",
    cause: "CV02 OP2 EMERGENCY ACTIVATED",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  303: {
    message: "STOP_PB_PRESSED",
    cause: "1.SENSOR POSITION MISSALIGNED 2.SHIPMENT IN FRONT OF THE SENSOR FOR 5MIN.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  304: {
    message: "X1_ALARM",
    cause: "1.SENSOR POSITION MISSALIGNED 2.THE SENSOR MUST BE SENSING THE CONVEYOR BELT FOR 5SEC. 3.SHIPMENT POSSIBLY STUCK IN FRONT OF THE SENSOR FOR 5SEC.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  305: {
    message: "X2_ALARM",
    cause: "1.SENSOR POSITION MISSALIGNED 2.THE SENSOR MUST BE SENSING THE CONVEYOR BELT FOR 5SEC. 3.SHIPMENT POSSIBLY STUCK IN FRONT OF THE SENSOR FOR 5SEC.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  306: {
    message: "X3_ALARM",
    cause: "1.SENSOR POSITION MISSALIGNED 2.THE SENSOR MUST BE SENSING THE CONVEYOR BELT FOR 5SEC. 3.SHIPMENT POSSIBLY STUCK IN FRONT OF THE SENSOR FOR 5SEC.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  307: {
    message: "LEFT_LIFTER_ALARM",
    cause: "1.SENSOR POSITION MISSALIGNED 2.THE SENSOR MUST BE SENSING THE CONVEYOR BELT FOR 5SEC. 3.SHIPMENT POSSIBLY STUCK IN FRONT OF THE SENSOR FOR 5SEC.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  308: {
    message: "RIGHT_LIFTER_ALARM",
    cause: "1.WHEN GRC FULL SENSOR JAM FOR 5SEC.2.SHIPMENT PRESENT IN FRONT OF GRC SENSOR. 3.GRC SENSOR MISALIGNED .",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  309: {
    message: "LEFT_BARCODE_DISCONNECT",
    cause: "DIMENSION CAMERA COMMUNICATION NOT HEALTHY",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  310: {
    message: "RIGHT_BARCODE_DISCONNECT",
    cause: "1.DIMENSION CAMERA OFFLINE 2.CAMERA CABLE DISCONNECTED.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  311: {
    message: "LEFT_DIMENSION_DISCONNECT",
    cause: "1.WEIGHING COMMUNICATION NOT HEALTHY",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  312: {
    message: "RIGHT_DIMENSION_DISCONNECT",
    cause: ".HANDHELD SCANNER USB IS NOT PROPERLY CONNECTED TO THE HMI AND WILL DISCONNECT.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  313: {
    message: "LEFT_WEIGHT_DISCONNECT",
    cause: "BARCODE IS INVALID(BARCODE REJEX DID NOT MATCH).",
    machine_status: "RUNNING",
    Remarks: "AUTORESET"
  },
  314: {
    message: "RIGHT_WEIGHT_DISCONNECT",
    cause: "DIMENSIONS OR WEIGHT IS OVER OR UNDER LIMIT",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  315: {
    message: "X1_NOT_HOME",
    cause: "SERVER-PLC COMMUNICATION DOWN 1.SERVER CABLE DISCONNECT 2- SERVER SHUTDOWN",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  316: {
    message: "X2_NOT_HOME",
    cause: " If the scanner barcode doesn't reached the PLC/Server, then we will get this alarm",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  317: {
    message: "X3_NOT_HOME",
    cause: "If the Dimension/Weight data doesn't reached the PLC/Server, then we will get this alarm",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  318: {
    message: "LEFT_LIFTER_NOT_HOME",
    cause: "MAIN PANEL DRIVE 1 IN FAULT 1- ETHERNET CABLE DISCONNECTED",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  319: {
    message: "RIGHT_LIFTER_NOT_HOME",
    cause: "MAIN PANEL DRIVE 1 IN FAULT 1- ETHERNET CABLE DISCONNECTED",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  320: {
    message: "LEFT_PARCEL_LENGTH_UNDER_DEFINED",
    cause: "MAIN PANEL DRIVE 1 IN FAULT 1- ETHERNET CABLE DISCONNECTED",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  321: {
    message: "LEFT_PARCEL_LENGTH_OVER_DEFINED",
    cause: "1.START PB WIRE BREAK/ LOOSE CONNECTION 2.WHEN START PRESS FOR 5SEC.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  322: {
    message: "LEFT_PARCEL_WIDTH_UNDER_DEFINED",
    cause: "STOP PB WIRE BREAK/ LOOSE CONNECTION 2.WHEN STOP PRESS FOR 5SEC.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  323: {
    message: "LEFT_PARCEL_WIDTH_OVER_DEFINED",
    cause: "1.CV01 RESET PB WIRE BREAK/ LOOSE CONNECTION 2.WHEN RESET PB PRESS FOR 5 SEC.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  324: {
    message: "LEFT_PARCEL_HEIGHT_UNDER_DEFINED",
    cause: ". CV01 RESET PB WIRE BREAK/ LOOSE CONNECTION 2.WHEN RESET PRESS FOR 5 SEC. ",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  325: {
    message: "LEFT_PARCEL_HEIGHT_OVER_DEFINED",
    cause: "IF THE BARCODE HAS BEEN SCANNED AND IS PICKED, THIS MEAN WEIGHT INFEED SENSOR DIDN'T TRIGGERED WITHIN 1sec ",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  326: {
    message: "RIGHT_PARCEL_LENGTH_UNDER_DEFINED",
    cause: "IF THE BARCODE IS NOT SCANNED AND THE SHIPMENT IS DIRECTLY PUSHED TO CVW.",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  327: {
    message: "RIGHT_PARCEL_LENGTH_OVER_DEFINED",
    cause: "IF MAHCINE IS NOT IN USE FOR CONTINOUS 5 MINS - MACHINE SHOULD STOP",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  328: {
    message: "RIGHT_PARCEL_WIDTH_UNDER_DEFINED",
    cause: "SHIPMENT LENGTH EXCEEDING THE ACCEPTABLE SET LIMIT 1- OVER LENGTH SHIPMENT.",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  329: {
    message: "RIGHT_PARCEL_WIDTH_OVER_DEFINED",
    cause: "SHIPMENT WIDTH EXCEEDING THE ACCEPTABLE SET LIMIT 1- OVER WIDTH SHIPMENT.",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  330: {
    message: "RIGHT_PARCEL_HEIGHT_UNDER_DEFINED",
    cause: "SHIPMENT HEIGTH EXCEEDING THE ACCEPTABLE SET LIMIT 1- OVER HEIGHT SHIPMENT.",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  331: {
    message: "RIGHT_PARCEL_HEIGHT_OVER_DEFINED",
    cause: "SHIPMENT WEIGTH EXCEEDING THE ACCEPTABLE SET LIMIT 1- OVER WEIGHT SHIPMENT.",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  332: {
    message: "PLEASE_PROCESS_CALIBERATION_FOR_LEFT_FEED",
    cause: "SHIPMENT LENGTH BELOW THE MINIMUM ACCEPTABLE SET LIMIT 1- UNDER LENGTH SHIPMENT.",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  333: {
    message: "PLEASE_PROCESS_CALIBERATION_FOR_RIGHT_FEED",
    cause: "SHIPMENT WIDTH BELOW THE MINIMUM ACCEPTABLE SET LIMIT 1- UNDER WIDTH SHIPMENT.",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  334: {
    message: "INTERNET_CONNECTION_ERROR",
    cause: "SHIPMENT HEIGHT BELOW THE MINIMUM ACCEPTABLE SET LIMIT 1- UNDER HEIGHT SHIPMENT. ",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  335: {
    message: "LEFT_FEED_ZERO_DIMENSION_RECEIVED",
    cause: "SHIPMENT WEIGHT BELOW THE MINIMUM ACCEPTABLE SET LIMIT",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  336: {
    message: "LEFT_FEED_NO_DIMENSION_RECEIVED",
    cause: "HE SHIPMENTS WHICH ARE PROCESSED BEFORE THIS ALARM SHOULD BE PROCESSED WITHOUT FAIL",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  337: {
    message: "RIGHT_FEED_ZERO_DIMENSION_RECEIVED",
    cause: "CALIBRATION BOX RECEIVED DIMENSION AND WEIGHT ARE WITHIN TOLERANCE OF DEFINED DIMENSION AND WEIGHT",
    machine_status: "FALSE",
    Remarks: "AUTORESET"
  },
  338: {
    message: "RIGHT_FEED_NO_DIMENSION_RECEIVED",
    cause: "CALIBRATION BOX RECEIVED DIMENSION AND WEIGHT ARE NOT WITHIN TOLERANCE OF DEFINED DIMENSION AND WEIGHT",
    machine_status: "FALSE",
    Remarks: "Hard check enabled"
  },
  339: {
    message: "LEFT_FEED_CALIBERATION_FAILED",
    cause: "DIMENSIONS NOT RECEIVED FROM PLC WITHIN SET TIMEOUT",
    machine_status: "FALSE",
    Remarks: "Hard check enabled"
  },
  340: {
    message: "RIGHT_FEED_CALIBERATION_FAILED",
    cause: "WEIGHT IS NOT RECEIVED FROM PLC WITHIN SET TIMEOUT",
    machine_status: "FALSE",
    Remarks: "Hard check enabled"
  },
  341: {
    message: "LEFT_FEED_REAL_VOLUME_GREATER_THEN_BOX_VOLUME",
    cause: "SAME BARCODE RECEIVED FOR LAST NUMBER OF SHIPMENT, NUMBER/COUNT IS SET IN IT.",
    machine_status: "FALSE",
    Remarks: "Hard check enabled"
  },
  342: {
    message: "RIGHT_FEED_REAL_VOLUME_GREATER_THEN_BOX_VOLUME",
    cause: "SAME DIMENSIONS RECEIVED FOR LAST NUMBER OF PARCELS, NUMBER/COUNT IS SET IN IT. Count - 5",
    machine_status: "FALSE",
    Remarks: "Calibration Alarm"
  },
  343: {
    message: "LEFT_FEED_CALIBERATION_PASSED",
    cause: "SAME WEIGHT RECEIVED FOR LAST NUMBER OF PARCELS, NUMBER/COUNT IS SET IN IT Count - 5",
    machine_status: "FALSE",
    Remarks: "Calibration Alarm"
  },
  344: {
    message: "RIGHT_FEED_CALIBERATION_PASSED",
    cause: "TWO SHIPMENT DETECT ON CONVEYOR 2.RECEIVED BOX COUNT OF THE PARCEL FROM DIMENSION CAMERA IS GREATER THAN 1.",
    machine_status: "FALSE",
    Remarks: "Hard check enabled"
  },
  345: {
    message: "UP_CART_LEFT_ENTRY_SENSOR_CONTINOUS_ON",
    cause: "1.CLIENT INTERNET DOWN 2. INTERNET CABLE DISCONNECT",
    machine_status: "FALSE",
    Remarks: "Hard check enabled"
  },
  346: {
    message: "UP_CART_LEFT_EXIT_SENSOR_CONTINOUS_ON",
    cause: "ZERO DIMENSION RECEIVED FROM PLC TO Mechint",
    machine_status: "FALSE",
    Remarks: "Calibration Alarm"
  },
  347: {
    message: "UP_CART_RIGHT_ENTRY_SENSOR_CONTINOUS_ON",
    cause: "ZERO WEIGHT RECEIVED FROM PLC ",
    machine_status: "FALSE",
    Remarks: "Calibration Alarm"
  },
  348: {
    message: "UP_CART_RIGHT_EXIT_SENSOR_CONTINOUS_ON",
    cause: "NEGATIVE DIMENSION RECEIVED FROM PLC",
    machine_status: "FALSE",
    Remarks: "Calibration Alarm"
  },
  349: {
    message: "MIDDLE_CART_LEFT_ENTRY_SENSOR_CONTINOUS_ON",
    cause: "IMAGE NOT SELECTED FOR THAT SHIPEMENT OR IMAGE IS NOT TRANSFERRED IN FTP.",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  350: {
    message: "MIDDLE_CART_LEFT_EXIT_SENSOR_CONTINOUS_ON",
    cause: "GETTING REAL VOLUME GREATER THAN VOLUME FROM DIMENSION CAMERA",
    machine_status: "N/A",
    Remarks: "Calibration Alarm"
  },
  351: {
    message: "MIDDLE_CART_RIGHT_ENTRY_SENSOR_CONTINOUS_ON",
    cause: "DIMENSIONING_SCANNER_DISCONNECTED",
    machine_status: "FALSE",
    Remarks: "Calibration Alarm"
  },
  352: {
    message: "MIDDLE_CART_RIGHT_EXIT_SENSOR_CONTINOUS_ON",
    cause: "WHEN THE USER IS NOT LOGGED IN ON THE DASHBOARD.",
    machine_status: "FALSE",
    Remarks: "Hard check enabled"
  },
  353: {
    message: "DOWN_CART_LEFT_ENTRY_SENSOR_CONTINOUS_ON",
    cause: "BLANK DATA RECEIVED FROM PLC TO Software",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  354: {
    message: "DOWN_CART_LEFT_EXIT_SENSOR_CONTINOUS_ON",
    cause: "Y_AXIS_NOT_HOME",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  355: {
    message: "DOWN_CART_RIGHT_ENTRY_SENSOR_CONTINOUS_ON",
    cause: "spare3",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  356: {
    message: "DOWN_CART_RIGHT_EXIT_SENSOR_CONTINOUS_ON",
    cause: "spare4",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  357: {
    message: "LEFT_BUFFER_EXIT_SENSOR_CONTINOUS_ON",
    cause: "spare5",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  358: {
    message: "RIGHT_BUFFER_EXIT_SENSOR_CONTINOUS_ON",
    cause: "spare6",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  359: {
    message: "LEFT_FEED_EXIT_SENSOR_CONTINOUS_ON",
    cause: "spare7",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  360: {
    message: "RIGHT_FEED_EXIT_SENSOR_CONTINOUS_ON",
    cause: "spare8",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  361: {
    message: "CURTAIN_SENSOR_CONTINOUS_ON",
    cause: "spare9",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  362: {
    message: "PARCEL_PICKED_FROM_LEFT_FEED",
    cause: "spare10",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  363: {
    message: "PARCEL_PICKED_FROM_RIGHT_FEED",
    cause: "spare11",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  364: {
    message: "spare1",
    cause: "spare12",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  365: {
    message: "spare2",
    cause: "spare12",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  366: {
    message: "spare3",
    cause: "spare12",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  367: {
    message: "spare4",
    cause: "spare12",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  368: {
    message: "spare5",
    cause: "spare5",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  369: {
    message: "spare6",
    cause: "spare6",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  370: {
    message: "spare7",
    cause: "spare7",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  371: {
    message: "spare8",
    cause: "spare8",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  372: {
    message: "spare9",
    cause: "spare9",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  373: {
    message: "spare10",
    cause: "spare10",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  374: {
    message: "spare11",
    cause: "spare11",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  375: {
    message: "spare12",
    cause: "spare12",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  376: {
    message: "spare13",
    cause: "spare13",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  377: {
    message: "spare14",
    cause: "spare14",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  378: {
    message: "spare15",
    cause: "spare15",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  379: {
    message: "spare16",
    cause: "spare16",
    machine_status: "FALSE",
    Remarks: "N/A"
  },
  380: {
    message: "spare17",
    cause: "spare17",
    machine_status: "FALSE",
    Remarks: "N/A"
  }
};
module.exports = alarmDictionary;